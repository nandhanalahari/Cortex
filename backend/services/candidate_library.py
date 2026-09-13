"""Pre-generated candidate takes for the redo loop.

Our ElevenLabs plan doesn't include the video API, so the takes are made on the
ElevenLabs website and dropped in here instead of being generated per request.
One folder per video, or `default/` to serve any video:

  data/candidates/<video_id>/
    manifest.json      optional - segment, prompts, labels, scores
    take_1.mp4         a take (discovered by filename order when no manifest)
    take_1.mp3         optional sound effect, muxed onto the take
    take_1.json        optional TRIBE v2 activation JSON for the take

manifest.json (every field optional):

  {
    "t_start": 0, "t_end": 5,
    "positive_prompt": "...", "negative_prompt": "...",
    "candidates": [
      {"file": "take_1.mp4", "label": "Warm push-in", "audio": "take_1.mp3",
       "activation": "take_1.json", "engagement_score": 71}
    ]
  }

A take's engagement score comes from, in order: the manifest's
`engagement_score` (0-1 or 0-100), else the take's TRIBE JSON re-expressed on
the original video's normalization (both exports need `raw_regions` /
`raw_stats`, see infra/kaggle/export_activation.py), else it is shown as
unscored with the reason. Nothing is ever invented.

A take's TRIBE JSON is found by matching filename stem, or by its `video_id`.
"""
from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, List, Optional

from ..config import settings
from ..models import ActivationData
from . import ffmpeg_service
from .engagement_curve import absolute_score, rescore_against

VIDEO_EXTS = (".mp4", ".mov", ".webm", ".mkv")
AUDIO_EXTS = (".mp3", ".wav", ".m4a", ".aac")
DEFAULT_FOLDER = "default"


@dataclass
class Take:
    candidate_id: str
    label: str
    video: Path
    audio: Optional[Path] = None
    activation: Optional[Path] = None
    manifest_score: Optional[float] = None


@dataclass
class Library:
    folder: Path
    takes: List[Take]
    t_start: Optional[float] = None
    t_end: Optional[float] = None
    positive_prompt: Optional[str] = None
    negative_prompt: Optional[str] = None


def _sidecar(video: Path, exts: Iterable[str]) -> Optional[Path]:
    for ext in exts:
        p = video.with_suffix(ext)
        if p.exists():
            return p
    return None


def _id_key(name: str) -> str:
    # Kaggle may rewrite spaces/commas in an uploaded filename. Unlike
    # activation_loader.normalize_video_id this keeps "(1)", which is what
    # tells two ElevenLabs downloads of the same prompt apart.
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")


def _take_json(folder: Path, video: Path) -> Optional[Path]:
    """The take's TRIBE export: same stem, else any JSON whose video_id names the take."""
    exact = video.with_suffix(".json")
    if exact.exists():
        return exact
    want = _id_key(video.stem)
    for p in sorted(folder.glob("*.json")):
        if p.name == "manifest.json":
            continue
        if _id_key(p.stem) == want:
            return p
        try:
            vid = json.loads(p.read_text(encoding="utf-8")).get("video_id")
        except (json.JSONDecodeError, OSError, AttributeError):
            continue
        if vid and _id_key(str(vid)) == want:
            return p
    return None


def _within(folder: Path, name) -> Optional[Path]:
    """Resolve a manifest filename, refusing anything outside the folder."""
    if not name:
        return None
    p = (folder / str(name)).resolve()
    if folder.resolve() not in p.parents or not p.is_file():
        return None
    return p


def _as_float(value) -> Optional[float]:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _as_score(value) -> Optional[float]:
    """Accept 0-1 or 0-100, whichever the TRIBE notebook printed."""
    v = _as_float(value)
    if v is None:
        return None
    if v > 1.0:
        v /= 100.0
    return max(0.0, min(1.0, v))


def _as_text(value) -> Optional[str]:
    if not value:
        return None
    return str(value).strip() or None


def _load(folder: Path) -> Optional[Library]:
    manifest: dict = {}
    manifest_path = folder / "manifest.json"
    if manifest_path.exists():
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as exc:
            print(f"[candidates] ignoring unreadable {manifest_path}: {exc}")

    takes: List[Take] = []
    entries = manifest.get("candidates")
    if isinstance(entries, list) and entries:
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            video = _within(folder, entry.get("file"))
            if video is None:
                print(f"[candidates] {folder.name}: take file {entry.get('file')!r} not found")
                continue
            n = len(takes) + 1
            takes.append(Take(
                candidate_id=f"cand_{n}",
                label=_as_text(entry.get("label")) or f"Take {n}",
                video=video,
                audio=_within(folder, entry.get("audio")) or _sidecar(video, AUDIO_EXTS),
                activation=_within(folder, entry.get("activation")) or _take_json(folder, video),
                manifest_score=_as_score(entry.get("engagement_score")),
            ))
    else:
        videos = sorted(p for p in folder.iterdir() if p.is_file() and p.suffix.lower() in VIDEO_EXTS)
        for n, video in enumerate(videos, start=1):
            takes.append(Take(
                candidate_id=f"cand_{n}",
                label=f"Take {n}",
                video=video,
                audio=_sidecar(video, AUDIO_EXTS),
                activation=_take_json(folder, video),
            ))

    if not takes:
        return None
    return Library(
        folder=folder,
        takes=takes,
        t_start=_as_float(manifest.get("t_start")),
        t_end=_as_float(manifest.get("t_end")),
        positive_prompt=_as_text(manifest.get("positive_prompt")),
        negative_prompt=_as_text(manifest.get("negative_prompt")),
    )


def find(video_id: str) -> Optional[Library]:
    """Takes for this video, else the shared `default/` set, else None."""
    if not video_id or "/" in video_id or "\\" in video_id or ".." in video_id:
        return None
    for name in (video_id, DEFAULT_FOLDER):
        folder = settings.CANDIDATES_PATH / name
        if folder.is_dir():
            library = _load(folder)
            if library is not None:
                return library
    return None


def take_score(
    take: Take, reference: Optional[ActivationData], seconds: float
) -> tuple[Optional[float], str]:
    """(score, status) for one take, on the same scale as the original's segment.

    Only the first `seconds` count - that's the part that gets spliced in.
    Status says where a score came from, or why there isn't one:
    manifest | tribe | no_take_json | bad_take_json | no_original_json |
    original_json_outdated | take_json_outdated
    """
    if take.manifest_score is not None:
        return round(take.manifest_score, 4), "manifest"
    if take.activation is None:
        return None, "no_take_json"
    try:
        data = ActivationData.model_validate(json.loads(take.activation.read_text(encoding="utf-8")))
    except Exception as exc:  # noqa: BLE001 - an unreadable score must not sink the redo
        print(f"[candidates] unreadable TRIBE JSON {take.activation.name}: {exc}")
        return None, "bad_take_json"
    if reference is None:
        return None, "no_original_json"
    windows = rescore_against(data, reference)
    if windows is None:
        return None, "original_json_outdated" if reference.raw_stats is None else "take_json_outdated"
    score = absolute_score(windows, 0.0, seconds)
    if score is None:
        return None, "bad_take_json"
    return round(score, 4), "tribe"


def materialize(video_id: str, take: Take) -> Path:
    """A browser-playable H.264/AAC mp4 of the take in the workspace, SFX muxed in.

    Cached by source file identity: replacing a take re-renders it, while an
    untouched one costs nothing on the next redo.
    """
    sources = [p for p in (take.video, take.audio) if p is not None]
    identity = "|".join(f"{p}:{p.stat().st_mtime_ns}:{p.stat().st_size}" for p in sources)
    key = hashlib.sha1(identity.encode()).hexdigest()[:12]
    safe_id = re.sub(r"[^A-Za-z0-9_-]", "_", video_id)
    dest = settings.WORKSPACE_PATH / f"take_{safe_id}_{take.candidate_id}_{key}.mp4"
    if dest.exists():
        return dest

    settings.WORKSPACE_PATH.mkdir(parents=True, exist_ok=True)
    partial = dest.with_name(f"{dest.stem}.part.mp4")
    cmd = [settings.FFMPEG_BIN, "-y", "-i", str(take.video)]
    if take.audio is not None:
        # apad + shortest: a short SFX is padded with silence, never truncates the video.
        cmd += ["-i", str(take.audio), "-map", "0:v:0", "-map", "1:a:0", "-af", "apad", "-shortest"]
    else:
        cmd += ["-map", "0:v:0", "-map", "0:a:0?"]
    cmd += ["-c:v", "libx264", "-preset", "fast", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-movflags", "+faststart", str(partial)]
    ffmpeg_service._run(cmd)
    partial.replace(dest)
    return dest
