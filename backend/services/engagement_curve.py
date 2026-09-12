"""Composite engagement curve from TRIBE v2 cortical predictions.

TRIBE v2 outputs (T, 20484) fsaverage5 vertex activity — not a single score.
This module mirrors Percept's construction:

  engagement_score ≈ 0.5 * response_strength + 0.3 * temporal_retention + 0.2 * peak

and aggregates Glasser/HCP-MMP parcels into the six Cortex macro-regions
from the PRD.
"""

from __future__ import annotations

from typing import Any

import numpy as np

# Glasser parcel names (bare, both hemispheres pooled) → Cortex macro-regions.
# Aligns with HCP-MMP naming used by tribev2.utils.get_hcp_roi_indices.
REGION_PARCELS: dict[str, list[str]] = {
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

REGION_KEYS = list(REGION_PARCELS.keys())

_EPS = 1e-6
_SMOOTH_SIGMA = 1.0  # TR ≈ 1s; light BOLD-like smoothing


def _safe_z(x: np.ndarray) -> np.ndarray:
    return (x - float(np.mean(x))) / (float(np.std(x)) + _EPS)


def _smooth(x: np.ndarray, sigma: float = _SMOOTH_SIGMA) -> np.ndarray:
    try:
        from scipy.ndimage import gaussian_filter1d

        return gaussian_filter1d(x.astype(np.float64), sigma=sigma, truncate=3.0)
    except ImportError:
        return x.astype(np.float64)


def build_roi_masks_from_tribev2(
    mesh: str = "fsaverage5",
) -> dict[str, np.ndarray]:
    """Build vertex-index masks via tribev2's HCP helpers (GPU host only)."""
    from tribev2.utils import get_hcp_labels, get_hcp_roi_indices

    valid = set(get_hcp_labels(mesh=mesh, combine=False, hemi="both").keys())
    masks: dict[str, np.ndarray] = {}
    for region, parcels in REGION_PARCELS.items():
        idxs: list[np.ndarray] = []
        for p in parcels:
            if p not in valid:
                continue
            idxs.append(get_hcp_roi_indices(p, hemi="both", mesh=mesh))
        if not idxs:
            raise ValueError(f"No valid parcels for region {region!r}")
        masks[region] = np.unique(np.concatenate(idxs))
    return masks


def region_timeseries(
    preds: np.ndarray,
    masks: dict[str, np.ndarray] | None = None,
) -> dict[str, np.ndarray]:
    """Mean activity per macro-region over time. preds: (T, V).

    Without ``masks`` the six names are NOT anatomical — vertices are split into
    contiguous bands, which is only meaningful for wiring/UI tests.
    """
    if preds.ndim != 2:
        raise ValueError(f"preds must be (T, V), got {preds.shape}")

    if masks is None:
        t, v = preds.shape
        band = max(v // 6, 1)
        out = {}
        for i, key in enumerate(REGION_KEYS):
            start = i * band
            end = v if i == len(REGION_KEYS) - 1 else (i + 1) * band
            out[key] = preds[:, start:end].mean(axis=1)
        return out

    return {
        key: preds[:, masks[key]].mean(axis=1) if key in masks else preds.mean(axis=1)
        for key in REGION_KEYS
    }


def composite_engagement(curve: np.ndarray) -> dict[str, float]:
    """Percept-style shape features on one 1-D engagement curve."""
    c = _smooth(_safe_z(np.asarray(curve, dtype=np.float64)))
    n = len(c)
    if n == 0:
        return {
            "response_strength": 0.0,
            "peak_response": 0.0,
            "temporal_retention": 0.0,
            "engagement_score": 0.0,
        }

    response_strength = float(np.mean(c))
    peak_response = float(np.max(c))
    third = max(n // 3, 1)
    early = float(np.mean(c[:third]))
    late = float(np.mean(c[-third:]))
    temporal_retention = late / (abs(early) + _EPS)

    # Map features into a stable [0, 1]-ish score for the UI.
    sustained = 1.0 / (1.0 + np.exp(-response_strength))
    peak_n = 1.0 / (1.0 + np.exp(-peak_response))
    retention_n = float(np.clip(temporal_retention, 0.0, 2.0) / 2.0)
    engagement_score = float(0.5 * sustained + 0.2 * peak_n + 0.3 * retention_n)

    return {
        "response_strength": response_strength,
        "peak_response": peak_response,
        "temporal_retention": float(temporal_retention),
        "engagement_score": engagement_score,
    }


def windows_from_preds(
    preds: np.ndarray,
    segment_starts: list[float] | np.ndarray,
    tr: float = 1.0,
    masks: dict[str, np.ndarray] | None = None,
    window_sec: float | None = None,
) -> list[dict[str, Any]]:
    """Build PRD ActivationWindow list from TRIBE preds + segment start times.

    Parameters
    ----------
    preds:
        (T, V) cortical predictions.
    segment_starts:
        Start time (sec) of each TRIBE segment / TR, length T.
        Hemodynamic lag (~5s) is already baked into TRIBE offsets — we expose
        stimulus-aligned times as returned by the model segments.
    tr:
        Fallback TR if only length is known.
    masks:
        Optional ROI masks from build_roi_masks_from_tribev2.
    window_sec:
        If set, bin into fixed-width windows (e.g. 1.5s) for the timeline UI.
        If None, one window per TRIBE timestep.
    """
    preds = np.asarray(preds, dtype=np.float64)
    t = preds.shape[0]
    if len(segment_starts) != t:
        segment_starts = np.arange(t, dtype=np.float64) * tr
    else:
        segment_starts = np.asarray(segment_starts, dtype=np.float64)

    series = region_timeseries(preds, masks=masks)

    if window_sec is None:
        windows = []
        for i in range(t):
            t0 = float(segment_starts[i])
            t1 = float(segment_starts[i] + tr) if i + 1 >= t else float(segment_starts[i + 1])
            if t1 <= t0:
                t1 = t0 + tr
            regions = {
                k: float(1.0 / (1.0 + np.exp(-_safe_z(series[k])[i])))
                for k in REGION_KEYS
            }
            windows.append(
                {
                    "t_start": t0,
                    "t_end": t1,
                    "regions": regions,
                }
            )
        return windows

    # Fixed-width binning for UI glow timeline.
    duration = float(segment_starts[-1] + tr) if t else 0.0
    windows = []
    t_cursor = 0.0
    z_regions = {k: _safe_z(series[k]) for k in REGION_KEYS}

    while t_cursor < duration - 1e-6:
        t_end = min(t_cursor + window_sec, duration)
        mask = (segment_starts >= t_cursor) & (segment_starts < t_end)
        if not np.any(mask):
            # nearest TR
            idx = int(np.argmin(np.abs(segment_starts - t_cursor)))
            mask = np.zeros(t, dtype=bool)
            mask[idx] = True
        idxs = np.where(mask)[0]
        regions = {
            k: float(1.0 / (1.0 + np.exp(-float(np.mean(z_regions[k][idxs])))))
            for k in REGION_KEYS
        }
        windows.append(
            {
                "t_start": float(t_cursor),
                "t_end": float(t_end),
                "regions": regions,
            }
        )
        t_cursor = t_end

    return windows


def activation_payload(
    video_id: str,
    preds: np.ndarray,
    segment_starts: list[float] | np.ndarray,
    duration_sec: float | None = None,
    tr: float = 1.0,
    masks: dict[str, np.ndarray] | None = None,
    window_sec: float = 1.5,
) -> dict[str, Any]:
    """PM handoff / activation JSON: video_id, duration_sec, windows[{t_start,t_end,regions}]."""
    windows = windows_from_preds(
        preds,
        segment_starts,
        tr=tr,
        masks=masks,
        window_sec=window_sec,
    )
    if duration_sec is None:
        duration_sec = float(windows[-1]["t_end"]) if windows else 0.0
    return {
        "video_id": video_id,
        "duration_sec": float(duration_sec),
        "windows": windows,
    }
