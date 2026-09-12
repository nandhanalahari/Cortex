"""API routes (PRD Section 6). This is the contract the frontend depends on.

TRIBE v2 inference NEVER runs here. It runs on Kaggle GPU T4x2 only.
This backend only reads the precomputed JSON that the notebook exports.
"""
from __future__ import annotations

import json
import shutil
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile
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


# ── Upload endpoints (Kaggle output → local storage) ──────────────────

@router.post("/upload-activation")
async def upload_activation(file: UploadFile = File(...)) -> dict:
    """Accept a TRIBE v2 activation JSON exported from the Kaggle notebook.

    The JSON must match the handoff schema: {video_id, duration_sec, windows[...]}.
    Saved to data/activations/{video_id}.json so the UI can load it immediately.
    """
    if not file.filename or not file.filename.endswith(".json"):
        raise HTTPException(status_code=400, detail="File must be a .json file.")

    raw = await file.read()
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid JSON: {exc}") from exc

    video_id = payload.get("video_id")
    if not video_id or "windows" not in payload:
        raise HTTPException(
            status_code=422,
            detail="JSON must have 'video_id' and 'windows' keys (TRIBE v2 handoff schema).",
        )

    # Validate against our Pydantic model
    try:
        data = ActivationData.model_validate(payload)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Schema validation failed: {exc}") from exc

    # Save to activations directory
    dest = settings.ACTIVATION_DATA_PATH / f"{video_id}.json"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    return {
        "status": "ok",
        "video_id": video_id,
        "windows": len(data.windows),
        "duration_sec": data.duration_sec,
        "source": "kaggle_cloud_gpu",
    }


@router.post("/upload-video")
async def upload_video(file: UploadFile = File(...)) -> dict:
    """Upload a video file to pair with its activation JSON.

    The filename (minus extension) becomes the video_id, matching the activation JSON.
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided.")

    allowed = (".mp4", ".mov", ".webm", ".avi", ".mkv")
    ext = Path(file.filename).suffix.lower()
    if ext not in allowed:
        raise HTTPException(status_code=400, detail=f"Allowed formats: {', '.join(allowed)}")

    video_id = Path(file.filename).stem
    dest = settings.VIDEO_DATA_PATH / f"{video_id}.mp4"
    dest.parent.mkdir(parents=True, exist_ok=True)

    with dest.open("wb") as f:
        shutil.copyfileobj(file.file, f)

    # Auto-pair: does TRIBE v2 already have an activation JSON for this video?
    has_activation = video_id in activation_loader.list_available_videos()

    return {
        "status": "ok",
        "video_id": video_id,
        "size_mb": round(dest.stat().st_size / 1024 / 1024, 2),
        "has_activation": has_activation,
    }


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
