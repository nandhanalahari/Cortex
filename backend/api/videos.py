"""API routes (PRD Section 6). This is the contract the frontend depends on."""
from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from ..config import settings
from ..models import (
    ActivationData,
    Candidate,
    RedoRequest,
    RedoResponse,
    SelectRequest,
    SelectResponse,
)
from ..services import (
    activation_loader,
    elevenlabs_service,
    ffmpeg_service,
    gemini_service,
)
from ..services.engagement_curve import attach_scores, build_curve
from ..store import SegmentRecord, store

router = APIRouter(prefix="/api/videos", tags=["videos"])


@router.get("")
def list_videos() -> dict:
    """List demo videos that have a precomputed activation JSON available."""
    return {"videos": activation_loader.list_available_videos()}


@router.post("/{video_id}/load-activation")
def load_activation(video_id: str) -> ActivationData:
    """F1 + F2: load the handoff JSON and echo it back with engagement_score per window."""
    try:
        data = activation_loader.load_activation(video_id)
    except activation_loader.ActivationNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except activation_loader.ActivationSchemaError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return attach_scores(data)


@router.get("/{video_id}/curve")
def get_curve(video_id: str) -> dict:
    """Full engagement curve with derived markers (peak/drop-off) for the timeline."""
    try:
        data = activation_loader.load_activation(video_id)
    except activation_loader.ActivationNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    curve = build_curve(data)
    return {
        "video_id": curve.video_id,
        "duration_sec": curve.duration_sec,
        "peak_time": curve.peak_time,
        "peak_score": curve.peak_score,
        "scores": [s.__dict__ for s in curve.scores],
    }


@router.get("/{video_id}/source")
def get_source_video(video_id: str):
    """Serve the original demo video for playback."""
    try:
        path = ffmpeg_service.source_video_path(video_id)
    except ffmpeg_service.FFmpegError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return FileResponse(path, media_type="video/mp4")


@router.post("/{video_id}/segments/redo", response_model=RedoResponse)
def redo_segment(video_id: str, req: RedoRequest) -> RedoResponse:
    """F5-F7: extract segment -> Gemini prompt pair -> ElevenLabs candidates."""
    if req.t_end <= req.t_start:
        raise HTTPException(status_code=400, detail="t_end must be greater than t_start.")

    try:
        segment_path = ffmpeg_service.extract_segment(video_id, req.t_start, req.t_end)
        seed_frame = ffmpeg_service.grab_seed_frame(video_id, req.t_start)
    except ffmpeg_service.FFmpegError as exc:
        raise HTTPException(status_code=500, detail=f"ffmpeg: {exc}") from exc

    positive, negative = gemini_service.analyze_segment(segment_path, req.t_start, req.t_end)

    generated = elevenlabs_service.generate_candidates(
        positive_prompt=positive,
        negative_prompt=negative,
        seed_frame=seed_frame,
        segment_path=segment_path,
        duration=req.t_end - req.t_start,
    )
    if not generated:
        raise HTTPException(status_code=502, detail="No candidate segments were produced.")

    segment_id = store.new_segment_id()
    rec = SegmentRecord(
        segment_id=segment_id,
        video_id=video_id,
        t_start=req.t_start,
        t_end=req.t_end,
        positive_prompt=positive,
        negative_prompt=negative,
        candidate_source=generated[0].source,
    )
    candidates = []
    for g in generated:
        rec.candidates[g.candidate_id] = g.path
        candidates.append(Candidate(candidate_id=g.candidate_id, preview_url=f"/media/{g.path.name}"))
    store.put_segment(rec)

    return RedoResponse(
        segment_id=segment_id,
        positive_prompt=positive,
        negative_prompt=negative,
        candidates=candidates,
    )


@router.post("/{video_id}/segments/{segment_id}/select", response_model=SelectResponse)
def select_candidate(video_id: str, segment_id: str, req: SelectRequest) -> SelectResponse:
    """F9: splice the chosen candidate back into the full video."""
    rec = store.get_segment(segment_id)
    if rec is None or rec.video_id != video_id:
        raise HTTPException(status_code=404, detail=f"Unknown segment '{segment_id}' for '{video_id}'.")

    replacement = rec.candidates.get(req.candidate_id)
    if replacement is None:
        raise HTTPException(status_code=404, detail=f"Unknown candidate '{req.candidate_id}'.")

    try:
        spliced = ffmpeg_service.splice_segment(video_id, rec.t_start, rec.t_end, replacement)
    except ffmpeg_service.FFmpegError as exc:
        raise HTTPException(status_code=500, detail=f"ffmpeg splice: {exc}") from exc

    store.set_spliced(video_id, spliced)
    return SelectResponse(video_id=video_id, status="spliced", preview_url=f"/media/{spliced.name}")


@router.get("/{video_id}/export")
def export_video(video_id: str):
    """F10: export/download the final edited video."""
    spliced = store.get_spliced(video_id)
    if spliced is None:
        raise HTTPException(status_code=404, detail="Nothing spliced yet for this video.")
    final = ffmpeg_service.export_final(spliced, video_id)
    store.set_exported(video_id, final)
    return FileResponse(final, media_type="video/mp4", filename=final.name)
