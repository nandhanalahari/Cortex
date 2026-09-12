"""F7: ElevenLabs video generation.

Sends the Gemini prompt pair (+ a seed frame from the original segment for
visual continuity) to ElevenLabs' Image & Video API and returns 2-3 candidate
video clips.

ElevenLabs' Image & Video API is asynchronous (submit -> poll -> download a
signed URL) and requires a Pro plan. We use the `flows.video` surface with an
image-to-video model (`start_frame` seeding). When OFFLINE_MODE is set, no key
is present, or the API errors, we fall back to generating visibly-distinct
local variant clips from the original segment so the pipeline stays runnable
for the demo (PRD Section 10). AI-generated candidates are labelled as such in
the UI (PRD Section 10 honesty contract).
"""
from __future__ import annotations

import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional

import requests

from ..config import settings
from . import ffmpeg_service

# Default image-to-video model (accepts start_frame; fast tier for demo speed).
_VIDEO_MODEL = "veo-3.1-fast-generate-001"
_POLL_INTERVAL_SEC = 10
_POLL_TIMEOUT_SEC = 360


@dataclass
class GeneratedCandidate:
    candidate_id: str
    path: Path
    source: str  # "elevenlabs" | "local_fallback"


def _duration_bucket(seconds: float) -> int:
    """Veo accepts discrete durations (4, 6, 8)."""
    for allowed in (4, 6, 8):
        if seconds <= allowed:
            return allowed
    return 8


# ---- Local fallback (ffmpeg variant clips) ----

# Three distinct visual treatments so candidates look meaningfully different.
_FALLBACK_FILTERS = [
    ("warm_pushin", "eq=contrast=1.15:saturation=1.25:brightness=0.03,zoompan=z='min(zoom+0.0015,1.15)':d=1:s=1280x720"),
    ("cool_cine", "eq=contrast=1.2:saturation=0.9:gamma=0.95,curves=preset=darker,hue=h=-8"),
    ("vivid_punch", "eq=contrast=1.25:saturation=1.4,unsharp=5:5:0.8"),
]


def _local_fallback(segment_path: Path, n: int) -> List[GeneratedCandidate]:
    out: List[GeneratedCandidate] = []
    for i in range(min(n, len(_FALLBACK_FILTERS))):
        label, vf = _FALLBACK_FILTERS[i]
        dest = settings.WORKSPACE_PATH / f"cand_{uuid.uuid4().hex}.mp4"
        try:
            ffmpeg_service._run([
                settings.FFMPEG_BIN, "-y", "-i", str(segment_path),
                "-vf", vf, "-c:v", "libx264", "-c:a", "aac", "-preset", "fast",
                str(dest),
            ])
            out.append(GeneratedCandidate(candidate_id=f"cand_{i+1}", path=dest, source="local_fallback"))
        except Exception as exc:  # noqa: BLE001
            print(f"[elevenlabs] fallback variant '{label}' failed: {exc}")
    return out


# ---- Real ElevenLabs path ----


def _generate_one_remote(client, prompt: str, negative_prompt: str,
                         seed_frame: Optional[Path], duration: float) -> Optional[Path]:
    from elevenlabs import VideoGenerationRequest_Veo31FastGenerate001  # type: ignore

    full_prompt = prompt
    if negative_prompt:
        full_prompt = f"{prompt}\n\nAvoid: {negative_prompt}"

    kwargs = dict(
        prompt=full_prompt,
        duration_secs=_duration_bucket(duration),
        aspect_ratio="16:9",
        resolution="1080p",
        generate_audio=True,
    )

    # Seed the first frame for continuity when we have one (image-to-video).
    if seed_frame is not None and seed_frame.exists():
        try:
            asset = client.flows.assets.create(file=str(seed_frame))  # type: ignore[attr-defined]
            kwargs["start_frame"] = asset.id
        except Exception as exc:  # noqa: BLE001
            print(f"[elevenlabs] seed-frame upload skipped ({exc}); using text-to-video.")

    generation = client.flows.video.create(
        request=VideoGenerationRequest_Veo31FastGenerate001(**kwargs)
    )

    deadline = time.time() + _POLL_TIMEOUT_SEC
    result = generation
    while getattr(result, "status", "pending") in ("pending", "generating"):
        if time.time() > deadline:
            raise TimeoutError("ElevenLabs generation timed out")
        time.sleep(_POLL_INTERVAL_SEC)
        result = client.flows.video.get(generation.id)

    if getattr(result, "status", None) == "failed":
        raise RuntimeError(f"{getattr(result, 'failure_reason', '?')}: {getattr(result, 'error_message', '')}")

    content_url = result.content_url
    dest = settings.WORKSPACE_PATH / f"cand_{uuid.uuid4().hex}.mp4"
    dest.write_bytes(requests.get(content_url, timeout=120).content)
    return dest


def generate_candidates(
    positive_prompt: str,
    negative_prompt: str,
    seed_frame: Optional[Path],
    segment_path: Path,
    duration: float,
    n: int = 3,
) -> List[GeneratedCandidate]:
    """Return up to `n` candidate clips for the segment."""
    settings.WORKSPACE_PATH.mkdir(parents=True, exist_ok=True)

    if settings.OFFLINE_MODE or not settings.ELEVENLABS_API_KEY:
        return _local_fallback(segment_path, n)

    try:
        from elevenlabs.client import ElevenLabs  # type: ignore

        client = ElevenLabs(api_key=settings.ELEVENLABS_API_KEY)
        candidates: List[GeneratedCandidate] = []
        for i in range(n):
            path = _generate_one_remote(client, positive_prompt, negative_prompt, seed_frame, duration)
            if path:
                candidates.append(GeneratedCandidate(candidate_id=f"cand_{i+1}", path=path, source="elevenlabs"))
        if candidates:
            return candidates
        print("[elevenlabs] no candidates returned; using local fallback.")
        return _local_fallback(segment_path, n)
    except Exception as exc:  # noqa: BLE001 - demo resilience
        print(f"[elevenlabs] falling back to local variants: {exc}")
        return _local_fallback(segment_path, n)
