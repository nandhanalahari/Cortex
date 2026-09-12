"""F1: Load precomputed activation JSON for a selected demo video.

This reads the handoff JSON produced by your teammate's Kaggle run (PRD Section 2).
It contains NO model code and never touches a GPU, Hugging Face, or `tribev2`.
Its only input is a JSON file on disk in the agreed shape.
"""
from __future__ import annotations

import json
from pathlib import Path

from ..config import settings
from ..models import REGION_KEYS, ActivationData


class ActivationNotFoundError(FileNotFoundError):
    pass


class ActivationSchemaError(ValueError):
    pass


def _activation_path(video_id: str) -> Path:
    """Search primary (data/activations/) then fallback (data/precomputed/)."""
    primary = settings.ACTIVATION_DATA_PATH / f"{video_id}.json"
    if primary.exists():
        return primary
    fallback = settings.ACTIVATION_FALLBACK_PATH / f"{video_id}.json"
    if fallback.exists():
        return fallback
    return primary  # return primary for the error message


def load_activation(video_id: str) -> ActivationData:
    """Load and validate `<video_id>.json` from the handoff directory."""
    path = _activation_path(video_id)
    if not path.exists():
        raise ActivationNotFoundError(
            f"No activation JSON for '{video_id}' at {path}. "
            f"Expected a file dropped there by your teammate's export."
        )

    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ActivationSchemaError(f"{path.name} is not valid JSON: {exc}") from exc

    data = ActivationData.model_validate(raw)
    _validate_regions(data)
    return data


def _validate_regions(data: ActivationData) -> None:
    """Fail loudly if the handoff shape drifts (PRD Section 2: don't discover from a crash)."""
    if not data.windows:
        raise ActivationSchemaError(f"{data.video_id}: 'windows' is empty.")

    for i, w in enumerate(data.windows):
        missing = [k for k in REGION_KEYS if k not in w.regions]
        if missing:
            raise ActivationSchemaError(
                f"{data.video_id} window {i} ({w.t_start}-{w.t_end}s) missing regions: {missing}. "
                f"The handoff contract requires all six macro-regions."
            )


def list_available_videos() -> list[str]:
    """All video_ids that have a precomputed activation JSON available."""
    ids: set[str] = set()
    for d in (settings.ACTIVATION_DATA_PATH, settings.ACTIVATION_FALLBACK_PATH):
        if d.exists():
            ids.update(p.stem for p in d.glob("*.json"))
    return sorted(ids)
