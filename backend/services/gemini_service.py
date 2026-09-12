"""F6: Gemini integration.

Send an extracted video segment (multimodal) to Gemini and receive a
`{positive_prompt, negative_prompt}` pair describing how to regenerate that
moment better. Falls back to a deterministic mock when OFFLINE_MODE is set or
no key is configured (PRD Section 10: build an offline path for the demo).
"""
from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Tuple

from ..config import settings

_SYSTEM_INSTRUCTION = (
    "You are a creative director analyzing a short video segment that underperformed "
    "on a neuro-engagement signal. Study the clip's pacing, subject, motion, lighting, "
    "and emotional beat. Produce a prompt pair to REGENERATE this same moment so it is "
    "more engaging while staying visually continuous with the original.\n"
    "Return STRICT JSON only: {\"positive_prompt\": string, \"negative_prompt\": string}.\n"
    "positive_prompt: a vivid, concrete image-to-video generation prompt for the improved moment.\n"
    "negative_prompt: what to avoid (artifacts, off-brand elements, jarring cuts)."
)


def _mock_pair(t_start: float, t_end: float) -> Tuple[str, str]:
    pos = (
        f"Re-energize the {t_end - t_start:.1f}s moment: keep the same subject and setting, "
        "add dynamic camera push-in, warmer key light, crisper motion and a clear focal beat "
        "that lands on the product; cinematic, high-contrast, smooth 24fps continuity."
    )
    neg = (
        "flat static framing, muddy lighting, motion blur artifacts, warped faces, "
        "sudden scene change, text overlays, watermark, low detail"
    )
    return pos, neg


def analyze_segment(segment_path: Path, t_start: float, t_end: float) -> Tuple[str, str]:
    """Return (positive_prompt, negative_prompt) for the given segment clip."""
    if settings.OFFLINE_MODE or not settings.GEMINI_API_KEY:
        return _mock_pair(t_start, t_end)

    try:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=settings.GEMINI_API_KEY)

        # Upload the clip and wait for it to become ACTIVE.
        uploaded = client.files.upload(file=str(segment_path))
        for _ in range(30):
            if getattr(uploaded.state, "name", str(uploaded.state)) == "ACTIVE":
                break
            time.sleep(1)
            uploaded = client.files.get(name=uploaded.name)

        resp = client.models.generate_content(
            model=settings.GEMINI_MODEL,
            contents=[
                uploaded,
                "Analyze this segment and return the JSON prompt pair.",
            ],
            config=types.GenerateContentConfig(
                system_instruction=_SYSTEM_INSTRUCTION,
                response_mime_type="application/json",
            ),
        )
        data = json.loads(resp.text)
        return (
            str(data.get("positive_prompt", "")).strip() or _mock_pair(t_start, t_end)[0],
            str(data.get("negative_prompt", "")).strip() or _mock_pair(t_start, t_end)[1],
        )
    except Exception as exc:  # noqa: BLE001 - demo resilience over strictness
        print(f"[gemini] falling back to mock prompt pair: {exc}")
        return _mock_pair(t_start, t_end)
