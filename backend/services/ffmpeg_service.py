"""F5 / F9 / F10: ffmpeg-backed video ops.

- extract_segment: pull out a [t_start, t_end] range (video + audio).
- grab_seed_frame: single frame near a timestamp, used to seed ElevenLabs for
  visual continuity.
- splice_segment: replace the original [t_start, t_end] range with a chosen
  candidate clip in the full video.
- probe_duration: read a media file's duration.

All shell-outs go through subprocess with explicit args (no shell=True).
"""
from __future__ import annotations

import json
import subprocess
import uuid
from pathlib import Path
from typing import List

from ..config import settings


class FFmpegError(RuntimeError):
    pass


def _run(cmd: List[str]) -> str:
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise FFmpegError(f"Command failed ({' '.join(cmd[:2])}...):\n{proc.stderr.strip()}")
    return proc.stdout


def _new_path(suffix: str) -> Path:
    settings.WORKSPACE_PATH.mkdir(parents=True, exist_ok=True)
    return settings.WORKSPACE_PATH / f"{uuid.uuid4().hex}{suffix}"


def has_source(video_id: str) -> bool:
    """True when a source clip exists for this video_id."""
    for ext in (".mp4", ".mov", ".webm", ".mkv"):
        if (settings.VIDEO_DATA_PATH / f"{video_id}{ext}").exists():
            return True
    return False


def source_video_path(video_id: str) -> Path:
    """Locate the source demo video by id (tries common extensions)."""
    for ext in (".mp4", ".mov", ".webm", ".mkv"):
        p = settings.VIDEO_DATA_PATH / f"{video_id}{ext}"
        if p.exists():
            return p
    raise FFmpegError(
        f"No source video for '{video_id}' under {settings.VIDEO_DATA_PATH} "
        f"(looked for {video_id}.mp4/.mov/.webm/.mkv)."
    )


def probe_duration(path: Path) -> float:
    out = _run([
        settings.FFPROBE_BIN, "-v", "error",
        "-show_entries", "format=duration",
        "-of", "json", str(path),
    ])
    return float(json.loads(out)["format"]["duration"])


def extract_segment(video_id: str, t_start: float, t_end: float) -> Path:
    """F5: extract [t_start, t_end] (re-encoded for frame-accurate cuts)."""
    if t_end <= t_start:
        raise FFmpegError(f"Invalid range: t_end ({t_end}) must be > t_start ({t_start}).")
    src = source_video_path(video_id)
    out = _new_path(".mp4")
    _run([
        settings.FFMPEG_BIN, "-y",
        "-ss", f"{t_start:.3f}", "-to", f"{t_end:.3f}",
        "-i", str(src),
        "-c:v", "libx264", "-c:a", "aac", "-preset", "fast",
        str(out),
    ])
    return out


def grab_seed_frame(video_id: str, t_seconds: float) -> Path:
    """Single JPEG frame near `t_seconds`, used to seed image-to-video continuity."""
    src = source_video_path(video_id)
    out = _new_path(".jpg")
    _run([
        settings.FFMPEG_BIN, "-y",
        "-ss", f"{t_seconds:.3f}", "-i", str(src),
        "-frames:v", "1", "-q:v", "2",
        str(out),
    ])
    return out


def _concat(parts: List[Path], out: Path) -> None:
    """Concatenate clips by re-encoding through the concat filter (robust to codec diffs)."""
    parts = [p for p in parts if p is not None]
    if not parts:
        raise FFmpegError("Nothing to concatenate.")
    cmd: List[str] = [settings.FFMPEG_BIN, "-y"]
    for p in parts:
        cmd += ["-i", str(p)]
    n = len(parts)
    filt = "".join(f"[{i}:v:0][{i}:a:0]" for i in range(n)) + f"concat=n={n}:v=1:a=1[v][a]"
    cmd += ["-filter_complex", filt, "-map", "[v]", "-map", "[a]",
            "-c:v", "libx264", "-c:a", "aac", "-preset", "fast", str(out)]
    _run(cmd)


def splice_segment(video_id: str, t_start: float, t_end: float, replacement: Path) -> Path:
    """F9: replace [t_start, t_end] in the full video with `replacement`, return the new full video."""
    src = source_video_path(video_id)
    total = probe_duration(src)
    t_start = max(0.0, t_start)
    t_end = min(total, t_end)

    parts: List[Path] = []
    if t_start > 0.05:
        head = _new_path(".mp4")
        _run([settings.FFMPEG_BIN, "-y", "-ss", "0", "-to", f"{t_start:.3f}", "-i", str(src),
              "-c:v", "libx264", "-c:a", "aac", "-preset", "fast", str(head)])
        parts.append(head)

    parts.append(replacement)

    if t_end < total - 0.05:
        tail = _new_path(".mp4")
        _run([settings.FFMPEG_BIN, "-y", "-ss", f"{t_end:.3f}", "-to", f"{total:.3f}", "-i", str(src),
              "-c:v", "libx264", "-c:a", "aac", "-preset", "fast", str(tail)])
        parts.append(tail)

    out = _new_path(".mp4")
    _concat(parts, out)
    return out


def export_final(spliced: Path, video_id: str) -> Path:
    """F10: publish the spliced result to the outputs dir under a stable name."""
    settings.OUTPUT_PATH.mkdir(parents=True, exist_ok=True)
    dest = settings.OUTPUT_PATH / f"{video_id}_edited.mp4"
    dest.write_bytes(Path(spliced).read_bytes())
    return dest
