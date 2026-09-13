"""API routes (PRD Section 6). This is the contract the frontend depends on.

TRIBE v2 inference NEVER runs here. It runs on Kaggle GPU T4x2 only.
This backend only reads the precomputed JSON that the notebook exports.
"""
from __future__ import annotations

import json
import shutil
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

from .auth import get_optional_user
from ..config import settings
from ..models import (
    ActivationData,
    Candidate,
    RedoRequest,
    RedoResponse,
    SelectRequest,
    SelectResponse,
    SimilarSegment,
    Window,
)
from ..services import (
    activation_loader,
    candidate_library,
    elevenlabs_service,
    ffmpeg_service,
    gemini_service,
    memory_service,
    vertex_field,
)
from ..services.elevenlabs_service import GeneratedCandidate
from ..services.engagement_curve import (
    absolute_score,
    attach_scores,
    build_curve,
    rescore_against,
    weakest_span,
)
from ..store import SegmentRecord, store

router = APIRouter(prefix="/api/videos", tags=["videos"])

# Matches the frontend's fixed regenerate window (SegmentSelector.SEGMENT_LEN).
SEGMENT_LEN_SEC = 5.0


def _suggested_segment(
    video_id: str, library: candidate_library.Library | None
) -> tuple[float, float, str]:
    """(t_start, t_end, reason) for the moment to regenerate when the user doesn't pick one."""
    if library and library.t_start is not None and library.t_end is not None \
            and library.t_end > library.t_start:
        return library.t_start, library.t_end, "takes_generated_for"
    try:
        data = activation_loader.load_activation(video_id)
    except Exception:  # noqa: BLE001 - no activation just means no smarter suggestion
        return 0.0, SEGMENT_LEN_SEC, "default"
    t_start, t_end = weakest_span(data, SEGMENT_LEN_SEC)
    return t_start, t_end, "lowest_engagement"


def _activation_or_none(video_id: str) -> ActivationData | None:
    try:
        return activation_loader.load_activation(video_id)
    except Exception:  # noqa: BLE001 - a missing/invalid activation just means no score
        return None


def _baseline_engagement(video_id: str, t_start: float, t_end: float) -> float | None:
    """The original segment's score on the same scale as the candidates' scores."""
    data = _activation_or_none(video_id)
    if data is None:
        return None
    score = absolute_score(data.windows, t_start, t_end)
    return round(score, 4) if score is not None else None


def _prompt_pair(
    library: candidate_library.Library | None, segment_path: Path, t_start: float, t_end: float
) -> tuple[str, str]:
    """The prompts the takes were actually made from win over a fresh Gemini read."""
    if library and library.positive_prompt and library.negative_prompt:
        return library.positive_prompt, library.negative_prompt
    positive, negative = gemini_service.analyze_segment(segment_path, t_start, t_end)
    if library:
        return library.positive_prompt or positive, library.negative_prompt or negative
    return positive, negative


def _duration_or_none(path: Path) -> float | None:
    try:
        return round(ffmpeg_service.probe_duration(path), 2)
    except (ffmpeg_service.FFmpegError, KeyError, ValueError):
        return None


def _segment_engagement(video_id: str, t_start: float, t_end: float) -> float | None:
    """Mean engagement over the windows this segment covers, for creative memory.

    None whenever the activation isn't available - the memory row is still
    worth keeping without a score.
    """
    try:
        curve = build_curve(activation_loader.load_activation(video_id))
    except Exception:  # noqa: BLE001 - a missing curve must not fail a splice
        return None
    covered = [
        s.engagement_score
        for s in curve.scores
        if s.t_end > t_start and s.t_start < t_end
    ]
    return sum(covered) / len(covered) if covered else None


@router.get("")
def list_videos() -> dict:
    """List demo videos that have a precomputed activation JSON available."""
    vertex_field.ingest_kaggle_exports()
    ids = activation_loader.list_available_videos()
    items = [
        {
            "id": vid,
            "has_activation": True,
            "has_verts": vertex_field.has_verts(vid) or vertex_field.ensure_verts(vid) is not None,
            "has_video": ffmpeg_service.has_source(vid),
        }
        for vid in ids
    ]
    return {"videos": ids, "items": items}


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
async def upload_video(
    file: UploadFile = File(...),
    video_id: str | None = Form(None),
) -> dict:
    """Upload a video file to pair with its activation JSON.

    If ``video_id`` is sent (from a JSON/NPZ already uploaded), the file is
    saved under that id so playback matches TRIBE output even when the
    mp4 filename differs.
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided.")

    allowed = (".mp4", ".mov", ".webm", ".avi", ".mkv")
    ext = Path(file.filename).suffix.lower()
    if ext not in allowed:
        raise HTTPException(status_code=400, detail=f"Allowed formats: {', '.join(allowed)}")

    vertex_field.ingest_kaggle_exports()
    raw_id = (video_id or "").strip() or Path(file.filename).stem
    known = activation_loader.list_available_videos()
    video_id = activation_loader.resolve_tribe_id(raw_id, known) or raw_id
    dest = settings.VIDEO_DATA_PATH / f"{video_id}.mp4"
    dest.parent.mkdir(parents=True, exist_ok=True)

    with dest.open("wb") as f:
        shutil.copyfileobj(file.file, f)

    vertex_field.ensure_verts(video_id)
    has_activation = video_id in activation_loader.list_available_videos()
    has_verts = vertex_field.has_verts(video_id)

    return {
        "status": "ok",
        "video_id": video_id,
        "size_mb": round(dest.stat().st_size / 1024 / 1024, 2),
        "has_activation": has_activation,
        "has_verts": has_verts,
    }


@router.post("/upload-preds")
async def upload_preds(file: UploadFile = File(...)) -> dict:
    """Accept TRIBE v2's raw `{video_id}_preds.npz` (T × 20,484 vertices).

    Converted to a compact vertex-field JSON the UI uses for Percept-style
    per-vertex glow + lightning. Inference still never runs here.
    """
    if not file.filename or not file.filename.endswith(".npz"):
        raise HTTPException(status_code=400, detail="File must be a .npz (TRIBE v2 preds).")

    video_id = vertex_field.video_id_from_preds_name(file.filename)
    dest = vertex_field.npz_path(video_id)
    dest.parent.mkdir(parents=True, exist_ok=True)
    with dest.open("wb") as f:
        shutil.copyfileobj(file.file, f)

    try:
        payload = vertex_field.convert_npz(dest, video_id)
    except vertex_field.VertexFieldError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    return {
        "status": "ok",
        "video_id": video_id,
        "n_vertices": payload["n_vertices"],
        "n_frames": payload["n_frames"],
        "source": "kaggle_cloud_gpu",
    }


@router.get("/{video_id}/verts")
def get_verts(video_id: str) -> dict:
    """Per-vertex TRIBE field (0–255 × 20,484) plus spike-graph series."""
    vertex_field.ingest_kaggle_exports()
    payload = vertex_field.ensure_verts(video_id)
    if payload is None:
        raise HTTPException(
            status_code=404,
            detail=f"No vertex field for '{video_id}'. Drop the Kaggle _preds.npz into data/activations/.",
        )
    return payload


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
    return FileResponse(path, media_type="video/mp4", filename=path.name)


@router.get("/{video_id}/regen-options")
def regen_options(video_id: str) -> dict:
    """What the Resegment studio needs up front: the suggested moment, its
    current score, and whether pre-generated takes are waiting for this video."""
    library = candidate_library.find(video_id)
    t_start, t_end, reason = _suggested_segment(video_id, library)
    return {
        "video_id": video_id,
        "segment_len_sec": SEGMENT_LEN_SEC,
        "suggested": {"t_start": t_start, "t_end": t_end, "reason": reason},
        "baseline_engagement": _baseline_engagement(video_id, t_start, t_end),
        "has_library": library is not None,
        "n_takes": len(library.takes) if library else 0,
    }


@router.post("/{video_id}/segments/redo", response_model=RedoResponse)
def redo_segment(
    video_id: str,
    req: RedoRequest,
    user=Depends(get_optional_user),
) -> RedoResponse:
    """F5-F7: extract segment -> Gemini prompt pair -> candidates.

    Candidates come from the pre-generated library when one exists for this
    video (data/candidates/), otherwise from ElevenLabs / the local fallback.
    """
    library = candidate_library.find(video_id)
    if req.t_start is None or req.t_end is None:
        t_start, t_end, _ = _suggested_segment(video_id, library)
    else:
        t_start, t_end = req.t_start, req.t_end
    if t_end <= t_start:
        raise HTTPException(status_code=400, detail="t_end must be greater than t_start.")

    try:
        segment_path = ffmpeg_service.extract_segment(video_id, t_start, t_end)
        seed_frame = ffmpeg_service.grab_seed_frame(video_id, t_start)
    except ffmpeg_service.FFmpegError as exc:
        raise HTTPException(status_code=500, detail=f"ffmpeg: {exc}") from exc

    positive, negative = _prompt_pair(library, segment_path, t_start, t_end)

    # E1: the creative-memory lookup rides alongside generation rather than
    # gating it (PRD Section 13) - ElevenLabs is the long pole either way.
    pool = ThreadPoolExecutor(max_workers=1)
    try:
        memory_future = pool.submit(memory_service.find_similar, positive, negative)

        if library is not None:
            try:
                generated = [
                    GeneratedCandidate(
                        candidate_id=take.candidate_id,
                        path=candidate_library.materialize(video_id, take),
                        source="elevenlabs_web",
                    )
                    for take in library.takes
                ]
            except ffmpeg_service.FFmpegError as exc:
                raise HTTPException(status_code=500, detail=f"ffmpeg preparing takes: {exc}") from exc
        else:
            generated = elevenlabs_service.generate_candidates(
                positive_prompt=positive,
                negative_prompt=negative,
                seed_frame=seed_frame,
                segment_path=segment_path,
                duration=t_end - t_start,
            )
        if not generated:
            raise HTTPException(status_code=502, detail="No candidate segments were produced.")

        similar = memory_service.collect_similar(memory_future)
    finally:
        pool.shutdown(wait=False)

    takes = {take.candidate_id: take for take in library.takes} if library else {}
    # Takes are scored on the original's normalization so the numbers compare.
    reference = _activation_or_none(video_id) if library else None
    segment_id = store.new_segment_id()
    rec = SegmentRecord(
        segment_id=segment_id,
        video_id=video_id,
        t_start=t_start,
        t_end=t_end,
        positive_prompt=positive,
        negative_prompt=negative,
        candidate_source=generated[0].source,
    )
    candidates = []
    for i, g in enumerate(generated, start=1):
        rec.candidates[g.candidate_id] = g.path
        take = takes.get(g.candidate_id)
        score, status = (
            candidate_library.take_score(take, reference, t_end - t_start) if take else (None, None)
        )
        candidates.append(Candidate(
            candidate_id=g.candidate_id,
            preview_url=f"/media/{g.path.name}",
            label=take.label if take else f"Take {i}",
            engagement_score=score,
            score_status=status,
            duration_sec=_duration_or_none(g.path),
        ))
    store.put_segment(rec)
    memory_service.remember(
        segment_id, video_id, positive, negative, user_id=user.id if user else None
    )

    return RedoResponse(
        segment_id=segment_id,
        positive_prompt=positive,
        negative_prompt=negative,
        candidates=candidates,
        t_start=t_start,
        t_end=t_end,
        baseline_engagement=_baseline_engagement(video_id, t_start, t_end),
        candidate_source=generated[0].source,
        similar_segments=[SimilarSegment(**hit.__dict__) for hit in similar],
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
        # A 6s take in a 5s window would stretch the ad; keep its opening instead.
        replacement = ffmpeg_service.fit_to_duration(replacement, rec.t_end - rec.t_start)
        spliced = ffmpeg_service.splice_segment(video_id, rec.t_start, rec.t_end, replacement)
    except ffmpeg_service.FFmpegError as exc:
        raise HTTPException(status_code=500, detail=f"ffmpeg splice: {exc}") from exc

    store.set_spliced(video_id, spliced)
    memory_service.record_outcome(
        segment_id, req.candidate_id, _segment_engagement(video_id, rec.t_start, rec.t_end)
    )
    return SelectResponse(
        video_id=video_id,
        status="spliced",
        preview_url=f"/media/{spliced.name}",
        candidate_id=req.candidate_id,
        t_start=rec.t_start,
        t_end=rec.t_end,
        windows=_spliced_windows(video_id, rec.t_start, rec.t_end, req.candidate_id),
    )


def _spliced_windows(
    video_id: str, t_start: float, t_end: float, candidate_id: str
) -> list[Window] | None:
    """Activation windows for the spliced ad: the original's, with the replaced
    span swapped for the take's own TRIBE windows on the original's scale.

    None when the take has no usable TRIBE export - no curve is invented for it.
    """
    original = _activation_or_none(video_id)
    library = candidate_library.find(video_id)
    take = next((t for t in library.takes if t.candidate_id == candidate_id), None) if library else None
    if original is None or take is None or take.activation is None:
        return None
    try:
        take_data = ActivationData.model_validate(json.loads(take.activation.read_text(encoding="utf-8")))
    except Exception:  # noqa: BLE001 - an unreadable export just means no curve
        return None
    rescored = rescore_against(take_data, original)
    if rescored is None:
        return None

    seg = t_end - t_start
    before = [
        Window(t_start=w.t_start, t_end=min(w.t_end, t_start), regions=w.regions)
        for w in original.windows if w.t_start < t_start
    ]
    # Only the take's opening `seg` seconds are spliced in (fit_to_duration).
    inside = [
        Window(t_start=t_start + w.t_start, t_end=t_start + min(w.t_end, seg), regions=w.regions)
        for w in rescored if w.t_start < seg
    ]
    after = [
        Window(t_start=max(w.t_start, t_end), t_end=w.t_end, regions=w.regions)
        for w in original.windows if w.t_end > t_end
    ]
    return before + inside + after


@router.get("/{video_id}/export")
def export_video(video_id: str):
    """F10: export/download the final edited video."""
    spliced = store.get_spliced(video_id)
    if spliced is None:
        raise HTTPException(status_code=404, detail="Nothing spliced yet for this video.")
    final = ffmpeg_service.export_final(spliced, video_id)
    store.set_exported(video_id, final)
    return FileResponse(final, media_type="video/mp4", filename=final.name)
