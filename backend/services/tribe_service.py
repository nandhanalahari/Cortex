"""TRIBE activation cache for Cortex.

Inference NEVER runs on the laptop. Run ``infra/kaggle/tribe_v2_inference.ipynb``
on Kaggle GPU T4×2, download ``{video_id}.json``, place it in
``data/activations/``, then call ``get_activation(video_id)``.
"""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parents[2]
ACTIVATION_DIR = Path(os.environ.get("CORTEX_ACTIVATION_DIR", ROOT / "data" / "activations"))


class TribeService:
    """Serve precomputed TRIBE activations produced on Kaggle."""

    def __init__(self, activation_dir: Path | str | None = None) -> None:
        self.activation_dir = Path(activation_dir or ACTIVATION_DIR)
        self.activation_dir.mkdir(parents=True, exist_ok=True)

    def activation_path(self, video_id: str) -> Path:
        return self.activation_dir / f"{video_id}.json"

    def get_activation(self, video_id: str) -> dict[str, Any] | None:
        path = self.activation_path(video_id)
        if not path.is_file():
            logger.warning(
                "No activation for %s — run the Kaggle notebook and copy "
                "JSON into %s",
                video_id,
                self.activation_dir,
            )
            return None
        with path.open() as f:
            return json.load(f)

    def save_activation(self, payload: dict[str, Any]) -> Path:
        """Persist a JSON payload downloaded from Kaggle Output."""
        video_id = payload["video_id"]
        path = self.activation_path(video_id)
        with path.open("w") as f:
            json.dump(payload, f, indent=2)
        logger.info("Cached Kaggle activation → %s", path)
        return path

    def list_cached(self) -> list[str]:
        return sorted(p.stem for p in self.activation_dir.glob("*.json"))

    def require_activation(self, video_id: str) -> dict[str, Any]:
        data = self.get_activation(video_id)
        if data is None:
            raise FileNotFoundError(
                f"Missing data/activations/{video_id}.json. "
                "Open infra/kaggle/tribe_v2_inference.ipynb on Kaggle "
                "(GPU T4 x2), run it, download the Output JSON here."
            )
        return data
