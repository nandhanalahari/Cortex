"""Cortex interface backend — FastAPI app.

Loads precomputed TRIBE v2 activation JSON, builds engagement curves, and drives
the Gemini + ElevenLabs + ffmpeg redo/splice/export pipeline. Contains NO model
inference (that's the teammate's half, PRD Section 1).
"""
from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from .api.videos import router as videos_router
from .config import settings

app = FastAPI(title="Cortex Interface", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _startup() -> None:
    settings.ensure_dirs()
    from .services import vertex_field

    vertex_field.ingest_kaggle_exports()


@app.get("/api/health")
def health() -> dict:
    return {
        "status": "ok",
        "offline_mode": settings.OFFLINE_MODE,
        "gemini_configured": bool(settings.GEMINI_API_KEY),
        "elevenlabs_configured": bool(settings.ELEVENLABS_API_KEY),
    }


@app.get("/media/{filename}")
def media(filename: str):
    """Serve generated candidate clips / spliced results by filename."""
    # Prevent path traversal; only a bare filename is allowed.
    if "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="Invalid filename.")
    for base in (settings.WORKSPACE_PATH, settings.OUTPUT_PATH):
        candidate = base / filename
        if candidate.exists():
            return FileResponse(candidate, media_type="video/mp4")
    raise HTTPException(status_code=404, detail="Media not found.")


app.include_router(videos_router)
