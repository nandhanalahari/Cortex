"""Convert Kaggle TRIBE v2 `_preds.npz` into a web-ready vertex field.

TRIBE never runs here. This only reads the (T, 20484) array the notebook
already wrote and packs it as per-frame 0–255 vertex intensities + a pair of
spike-graph series (mean / peak).
"""
from __future__ import annotations

import json
import shutil
from pathlib import Path

import numpy as np

from ..config import settings


class VertexFieldError(ValueError):
    pass


def verts_path(video_id: str) -> Path:
    return settings.ACTIVATION_DATA_PATH / f"{video_id}_verts.json"


def npz_path(video_id: str) -> Path:
    return settings.ACTIVATION_DATA_PATH / f"{video_id}_preds.npz"


def has_verts(video_id: str) -> bool:
    return verts_path(video_id).exists()


def ensure_verts(video_id: str) -> dict | None:
    """Build `_verts.json` from a sitting Kaggle `_preds.npz` if needed."""
    if has_verts(video_id):
        return load_verts(video_id)
    src = npz_path(video_id)
    if not src.exists():
        return None
    return convert_npz(src, video_id)


def ingest_kaggle_exports() -> list[str]:
    """Pull Cell 6 downloads out of the inbox and convert every pending NPZ.

    Drop both Kaggle files into ``data/kaggle_inbox/`` or ``data/activations/``:
      - ``{VIDEO_ID}.json``
      - ``{VIDEO_ID}_preds.npz``
    """
    dest = settings.ACTIVATION_DATA_PATH
    dest.mkdir(parents=True, exist_ok=True)
    inbox = settings.KAGGLE_INBOX_PATH
    if inbox.exists():
        for p in inbox.iterdir():
            if p.is_file() and p.suffix.lower() in {".json", ".npz"}:
                target = dest / p.name
                if target.exists():
                    target.unlink()
                shutil.move(str(p), str(target))

    converted: list[str] = []
    for npz in dest.glob("*_preds.npz"):
        vid = video_id_from_preds_name(npz.name)
        if has_verts(vid):
            continue
        try:
            convert_npz(npz, vid)
            converted.append(vid)
        except VertexFieldError:
            continue
    return converted


def video_id_from_preds_name(filename: str) -> str:
    stem = Path(filename).stem
    if stem.endswith("_preds"):
        return stem[: -len("_preds")]
    return stem


def convert_npz(src: Path, video_id: str) -> dict:
    """Read preds.npz → write `{video_id}_verts.json`. Returns the payload."""
    try:
        data = np.load(src)
    except Exception as exc:
        raise VertexFieldError(f"Could not read NPZ: {exc}") from exc

    if "preds" not in data.files:
        raise VertexFieldError("NPZ missing 'preds' array (expected TRIBE v2 export).")

    preds = np.asarray(data["preds"], dtype=np.float32)
    if preds.ndim != 2 or preds.shape[1] < 1000:
        raise VertexFieldError(f"preds must be (T, ~20484), got {preds.shape}")

    t, v = preds.shape
    if "starts" in data.files:
        times = np.asarray(data["starts"], dtype=np.float32).reshape(-1)
        if times.shape[0] != t:
            times = np.arange(t, dtype=np.float32)
    else:
        times = np.arange(t, dtype=np.float32)

    frames: list[list[int]] = []
    means: list[float] = []
    peaks: list[float] = []
    for i in range(t):
        row = preds[i]
        lo, hi = np.percentile(row, [5.0, 99.0])
        span = max(float(hi - lo), 1e-6)
        norm = np.clip((row - lo) / span, 0.0, 1.0)
        frames.append(np.round(norm * 255.0).astype(np.uint8).tolist())
        means.append(float(norm.mean()))
        peaks.append(float(np.percentile(norm, 95.0)))

    payload = {
        "video_id": video_id,
        "n_vertices": int(v),
        "n_frames": int(t),
        "times": [float(x) for x in times],
        "mean": means,
        "peak": peaks,
        "frames": frames,
        "source": "kaggle_cloud_gpu",
    }
    dest = verts_path(video_id)
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    return payload


def load_verts(video_id: str) -> dict:
    path = verts_path(video_id)
    if not path.exists():
        raise FileNotFoundError(video_id)
    return json.loads(path.read_text(encoding="utf-8"))
