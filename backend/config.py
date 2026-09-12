"""Central configuration for the Cortex interface backend.

Everything here is scoped to *your* half (interface + pipeline). There are no
TRIBE / Kaggle / Hugging Face settings by design (PRD Section 1 & 8).

Activation JSONs are produced by your teammate's Kaggle notebook
(infra/kaggle/tribe_v2_inference.ipynb) and placed in data/activations/.
"""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

# Load .env from the repo root (one level up from /backend).
REPO_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(REPO_ROOT / ".env")


def _resolve(path_str: str) -> Path:
    p = Path(path_str)
    return p if p.is_absolute() else (REPO_ROOT / p).resolve()


class Settings:
    # --- Data locations (the handoff seam, PRD Section 2) ---
    # Primary: data/activations/ (teammate's Kaggle output)
    # Fallback: data/precomputed/ (legacy, for pre-existing demo data)
    ACTIVATION_DATA_PATH: Path = _resolve(
        os.getenv("CORTEX_ACTIVATION_DIR",
                   os.getenv("ACTIVATION_DATA_PATH", "./data/activations"))
    )
    ACTIVATION_FALLBACK_PATH: Path = _resolve("./data/precomputed")

    VIDEO_DATA_PATH: Path = _resolve(os.getenv("VIDEO_DATA_PATH", "./data/videos"))
    WORKSPACE_PATH: Path = _resolve(os.getenv("WORKSPACE_PATH", "./backend/workspace"))
    OUTPUT_PATH: Path = _resolve(os.getenv("OUTPUT_PATH", "./data/outputs"))

    # --- External APIs ---
    GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "")
    GEMINI_MODEL: str = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")

    ELEVENLABS_API_KEY: str = os.getenv("ELEVENLABS_API_KEY", "")
    ELEVENLABS_VIDEO_MODEL: str = os.getenv("ELEVENLABS_VIDEO_MODEL", "")

    # --- TigerData Creative Memory (E1, EXPLORATORY) ---
    # Unset -> memory falls back to an in-process store; nothing else changes.
    # TIGER_DATABASE_URL is what's actually provisioned in .env; accept the
    # documented name too so .env.example instructions still work verbatim.
    TIGERDATA_CONNECTION_STRING: str = os.getenv("TIGER_DATABASE_URL") or os.getenv(
        "TIGERDATA_CONNECTION_STRING", ""
    )
    GEMINI_EMBED_MODEL: str = os.getenv("GEMINI_EMBED_MODEL", "text-embedding-004")
    MEMORY_TOP_K: int = int(os.getenv("MEMORY_TOP_K", "3"))
    # Hard ceiling on the parallel lookup; candidates ship regardless.
    MEMORY_LOOKUP_TIMEOUT_SEC: float = float(os.getenv("MEMORY_LOOKUP_TIMEOUT_SEC", "3"))

    # --- Login (email + password, backed by TigerData) ---
    SESSION_TTL_DAYS: int = int(os.getenv("SESSION_TTL_DAYS", "7"))

    # --- Demo safety ---
    OFFLINE_MODE: bool = os.getenv("OFFLINE_MODE", "false").lower() in {"1", "true", "yes"}

    # --- ffmpeg ---
    FFMPEG_BIN: str = os.getenv("FFMPEG_BIN", "ffmpeg")
    FFPROBE_BIN: str = os.getenv("FFPROBE_BIN", "ffprobe")

    def ensure_dirs(self) -> None:
        for d in (self.ACTIVATION_DATA_PATH, self.ACTIVATION_FALLBACK_PATH,
                  self.VIDEO_DATA_PATH, self.WORKSPACE_PATH, self.OUTPUT_PATH):
            d.mkdir(parents=True, exist_ok=True)


settings = Settings()
