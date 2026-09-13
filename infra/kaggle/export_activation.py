"""Standalone TRIBE v2 → Cortex activation export (Kaggle / Colab / local GPU).

Paste-friendly script used by ``infra/kaggle/tribe_v2_inference.ipynb``.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import numpy as np


REGION_PARCELS = {
    "visual": [
        "V1", "V2", "V3", "V4", "V3A", "V3B", "V6", "V6A", "MT", "MST",
        "LO1", "LO2", "LO3", "V4t", "FST",
    ],
    "language": [
        "44", "45", "IFSa", "STSdp", "STSvp", "STGa", "TE1a", "A5",
        "PSL", "SFL", "55b",
    ],
    "reward_novelty": [
        "10r", "10v", "10d", "10pp", "p32", "s32", "a24", "d32", "25",
        "OFC", "pOFC", "11l", "13l", "9m",
    ],
    "memory_familiarity": [
        "7m", "POS2", "v23ab", "d23ab", "31pv", "31pd", "RSC", "PCV",
        "PHA1", "PHA2", "PHA3", "PreS", "EC",
    ],
    "emotional_arousal": [
        "A1", "LBelt", "MBelt", "PBelt", "A4", "A5",
        "STSdp", "STSvp", "STSda", "STSva", "TE1p", "TE2p",
        "PI", "Ig", "52",
    ],
    "attention_salience": [
        "FEF", "LIPv", "LIPd", "VIP", "MIP", "AIP", "IP0", "IP1", "IP2",
        "TPOJ1", "TPOJ2", "PGi", "PGs", "PFm",
        "IFJa", "IFJp",
        "p9-46v", "a9-46v", "9-46d", "46", "8C", "i6-8", "s6-8",
    ],
}

_EPS = 1e-6


def _safe_z(x: np.ndarray) -> np.ndarray:
    return (x - float(np.mean(x))) / (float(np.std(x)) + _EPS)


def _sigmoid(x: float) -> float:
    return float(1.0 / (1.0 + np.exp(-x)))


def build_masks(mesh: str = "fsaverage5"):
    from tribev2.utils import get_hcp_labels, get_hcp_roi_indices

    valid = set(get_hcp_labels(mesh=mesh, combine=False, hemi="both").keys())
    masks = {}
    for region, parcels in REGION_PARCELS.items():
        idxs = []
        missing = []
        for p in parcels:
            if p not in valid:
                missing.append(p)
                continue
            idxs.append(get_hcp_roi_indices(p, hemi="both", mesh=mesh))
        if missing:
            print(f"[roi] {region}: dropped unknown parcels {missing}")
        if not idxs:
            raise ValueError(f"No parcels for {region}")
        masks[region] = np.unique(np.concatenate(idxs))
    return masks


def region_means(preds: np.ndarray, masks: dict[str, np.ndarray] | None):
    keys = list(REGION_PARCELS.keys())
    if masks is None:
        t, v = preds.shape
        band = max(v // 6, 1)
        out = {}
        for i, key in enumerate(keys):
            start = i * band
            end = v if i == len(keys) - 1 else (i + 1) * band
            out[key] = preds[:, start:end].mean(axis=1)
        return out
    return {k: preds[:, masks[k]].mean(axis=1) for k in keys}


def to_windows(preds, starts, tr=1.0, masks=None, window_sec=1.5, duration=None):
    preds = np.asarray(preds, dtype=np.float64)
    t = preds.shape[0]
    starts = np.asarray(starts if len(starts) == t else np.arange(t) * tr, dtype=np.float64)
    series = region_means(preds, masks)
    z_regions = {k: _safe_z(series[k]) for k in series}
    if duration is None:
        duration = float(starts[-1] + tr) if t else 0.0

    windows = []
    t_cursor = 0.0
    while t_cursor < duration - 1e-6:
        t_end = min(t_cursor + window_sec, duration)
        mask = (starts >= t_cursor) & (starts < t_end)
        if not np.any(mask):
            idx = int(np.argmin(np.abs(starts - t_cursor)))
            mask = np.zeros(t, dtype=bool)
            mask[idx] = True
        idxs = np.where(mask)[0]
        regions = {k: _sigmoid(float(np.mean(z_regions[k][idxs]))) for k in z_regions}
        windows.append(
            {
                "t_start": float(t_cursor),
                "t_end": float(t_end),
                "regions": regions,
                # Un-normalized means: lets Cortex score another clip (an AI
                # take) on the scale of this video instead of on the clip by itself.
                "raw_regions": {k: float(np.mean(series[k][idxs])) for k in series},
            }
        )
        t_cursor = t_end
    raw_stats = {k: {"mean": float(np.mean(v)), "std": float(np.std(v))} for k, v in series.items()}
    return windows, float(duration), raw_stats


def run_inference(
    video_path: str,
    video_id: str,
    cache_folder: str = "/kaggle/working/cache",
    out_dir: str = "/kaggle/working/activations",
    window_sec: float = 1.5,
    device: str = "cuda",
):
    import torch
    from tribev2 import TribeModel

    video_path = Path(video_path)
    assert video_path.is_file(), video_path

    print("torch", torch.__version__, "cuda", torch.cuda.is_available())
    print("gpu_count", torch.cuda.device_count())
    for i in range(torch.cuda.device_count()):
        print(f"  gpu[{i}]", torch.cuda.get_device_name(i))

    # Dual T4: keep primary weights on cuda:0. Second GPU is headroom /
    # feature-cache IO; TribeModel itself is single-device today.
    if device == "cuda" and torch.cuda.device_count() == 0:
        device = "cpu"
        print("WARNING: falling back to CPU")

    model = TribeModel.from_pretrained(
        "facebook/tribev2",
        cache_folder=cache_folder,
        device=device,
    )
    print("Building events dataframe (ASR + audio extract)…")
    events = model.get_events_dataframe(video_path=str(video_path))
    print("events rows", len(events), "cols", list(events.columns)[:12])

    print("Running predict()…")
    preds, segments = model.predict(events=events, verbose=True)
    print("preds", preds.shape)

    starts = [float(getattr(seg, "start", i)) for i, seg in enumerate(segments)]
    tr = float(getattr(model.data, "TR", 1.0))

    try:
        masks = build_masks()
        print("ROI grouping: HCP-MMP via tribev2.utils")
    except Exception as exc:
        if os.environ.get("CORTEX_ALLOW_BAND_FALLBACK") != "1":
            raise RuntimeError(
                "HCP-MMP atlas unavailable, so the six region names would not be "
                "anatomical. Fix the mne atlas download, or set "
                "CORTEX_ALLOW_BAND_FALLBACK=1 to export placeholder groupings."
            ) from exc
        print("WARNING: band fallback — region names are NOT anatomical:", exc)
        masks = None

    duration = None
    try:
        from moviepy import VideoFileClip

        with VideoFileClip(str(video_path)) as clip:
            duration = float(clip.duration)
    except Exception as exc:
        print("duration probe failed:", exc)

    windows, duration, raw_stats = to_windows(
        preds, starts, tr=tr, masks=masks, window_sec=window_sec, duration=duration
    )
    # PM handoff schema, plus the raw stats that `regions` was normalized with
    payload = {
        "video_id": video_id,
        "duration_sec": float(duration),
        "windows": windows,
        "raw_stats": raw_stats,
    }

    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    # Full cortical tensor (large) — optional, for offline re-binning.
    np.savez_compressed(
        out / f"{video_id}_preds.npz",
        preds=preds.astype(np.float32),
        starts=np.asarray(starts, dtype=np.float32),
    )
    json_path = out / f"{video_id}.json"
    with json_path.open("w") as f:
        json.dump(payload, f, indent=2)
    print("Wrote", json_path)
    for w in windows[:5]:
        r = w["regions"]
        print(
            f"  [{w['t_start']:.1f}-{w['t_end']:.1f}] "
            f"vis={r['visual']:.3f} attn={r['attention_salience']:.3f}"
        )
    return payload


if __name__ == "__main__":
    # CLI: python export_activation.py /path/to/video.mp4 vid_demo
    vp = sys.argv[1] if len(sys.argv) > 1 else None
    vid = sys.argv[2] if len(sys.argv) > 2 else "vid_demo"
    if not vp:
        raise SystemExit("Usage: export_activation.py VIDEO.mp4 [video_id]")
    run_inference(vp, vid)
