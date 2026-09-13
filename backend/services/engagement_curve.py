"""F2: Composite engagement curve builder.

This is *our own* scoring construction on top of TRIBE v2's raw six-region data.
TRIBE v2 has no built-in single "engagement" score (PRD Section 10, honesty
contract) - we derive one here so the glowing timeline has something to plot.

Construction:
  1. Weighted composite of the six macro-regions per window (`response_strength`).
  2. Min-max normalization across the video -> `engagement_score` in [0, 1] for
     stable UI glow intensity regardless of a given video's absolute scale.
  3. Light temporal smoothing to reduce single-window jitter.
  4. Derived markers: peak windows and drop-off (decline vs previous window).
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import List

from ..models import REGION_KEYS, ActivationData, Window

# Our engagement weighting. Attention/emotion/novelty drive "engagement" most;
# visual/language/memory are supporting signal. Documented as our construction.
REGION_WEIGHTS = {
    "visual": 0.12,
    "language": 0.12,
    "reward_novelty": 0.22,
    "memory_familiarity": 0.10,
    "emotional_arousal": 0.22,
    "attention_salience": 0.22,
}

# Symmetric moving-average half-window (in windows) for smoothing.
SMOOTHING_HALF_WIDTH = 1


@dataclass
class WindowScore:
    t_start: float
    t_end: float
    response_strength: float  # raw weighted composite
    engagement_score: float   # normalized + smoothed, [0, 1]
    is_peak: bool
    drop_off: float           # engagement_score[i-1] - engagement_score[i], clamped >= 0


@dataclass
class EngagementCurve:
    video_id: str
    duration_sec: float
    scores: List[WindowScore]

    @property
    def peak_score(self) -> float:
        return max((s.engagement_score for s in self.scores), default=0.0)

    @property
    def peak_time(self) -> float:
        if not self.scores:
            return 0.0
        peak = max(self.scores, key=lambda s: s.engagement_score)
        return (peak.t_start + peak.t_end) / 2.0


def _weighted_composite(regions: dict[str, float]) -> float:
    return sum(REGION_WEIGHTS[k] * float(regions.get(k, 0.0)) for k in REGION_KEYS)


def _smooth(values: List[float], half: int) -> List[float]:
    if half <= 0 or len(values) <= 2:
        return list(values)
    out: List[float] = []
    n = len(values)
    for i in range(n):
        lo, hi = max(0, i - half), min(n, i + half + 1)
        window = values[lo:hi]
        out.append(sum(window) / len(window))
    return out


def _normalize(values: List[float]) -> List[float]:
    if not values:
        return []
    lo, hi = min(values), max(values)
    if hi - lo < 1e-9:
        # Flat signal -> mid intensity, avoids divide-by-zero and a dead timeline.
        return [0.5 for _ in values]
    return [(v - lo) / (hi - lo) for v in values]


def build_curve(data: ActivationData, peak_percentile: float = 0.8) -> EngagementCurve:
    raw = [_weighted_composite(w.regions) for w in data.windows]
    normalized = _normalize(raw)
    smoothed = _smooth(normalized, SMOOTHING_HALF_WIDTH)

    # Peak threshold: windows in the top (1 - peak_percentile) band.
    if smoothed:
        ordered = sorted(smoothed)
        idx = min(len(ordered) - 1, int(peak_percentile * len(ordered)))
        peak_threshold = ordered[idx]
    else:
        peak_threshold = 1.0

    scores: List[WindowScore] = []
    prev = None
    for w, strength, eng in zip(data.windows, raw, smoothed):
        drop = max(0.0, prev - eng) if prev is not None else 0.0
        scores.append(
            WindowScore(
                t_start=w.t_start,
                t_end=w.t_end,
                response_strength=round(strength, 4),
                engagement_score=round(eng, 4),
                is_peak=eng >= peak_threshold and eng > 0.5,
                drop_off=round(drop, 4),
            )
        )
        prev = eng

    return EngagementCurve(video_id=data.video_id, duration_sec=data.duration_sec, scores=scores)


def absolute_score(
    windows: List[Window], t_start: float | None = None, t_end: float | None = None
) -> float | None:
    """Mean weighted composite over the windows overlapping [t_start, t_end].

    Unlike `engagement_score` this skips the per-video min-max step, so a
    candidate take scored on its own and the original's segment land on the
    same [0, 1] scale and can be compared directly. Same formula as the
    frontend's live meter (`engagementFrom`).
    """
    covered = [
        w for w in windows
        if (t_start is None or w.t_end > t_start) and (t_end is None or w.t_start < t_end)
    ]
    if not covered:
        return None
    return sum(_weighted_composite(w.regions) for w in covered) / len(covered)


def rescore_against(take: ActivationData, reference: ActivationData) -> List[Window] | None:
    """Re-express `take`'s raw region means on `reference`'s normalization.

    The notebook z-scores each region within its own video, so every export
    averages ~0.5 and two exports' `regions` can't be compared. Using the
    reference's raw mean/std instead gives the take exactly the values it would
    have had inside the reference video's normalization, while the reference's
    own `regions` (and so the original's score) stay unchanged.

    None when either export predates `raw_regions` / `raw_stats`.
    """
    if reference.raw_stats is None or any(w.raw_regions is None for w in take.windows):
        return None
    out: List[Window] = []
    for w in take.windows:
        regions: dict[str, float] = {}
        for key in REGION_KEYS:
            stats = reference.raw_stats.get(key)
            raw = w.raw_regions.get(key) if w.raw_regions else None
            if stats is None or raw is None:
                return None
            z = max(-40.0, min(40.0, (raw - stats.mean) / (stats.std + 1e-6)))
            regions[key] = 1.0 / (1.0 + math.exp(-z))
        out.append(Window(t_start=w.t_start, t_end=w.t_end, regions=regions))
    return out


def weakest_span(data: ActivationData, length: float) -> tuple[float, float]:
    """The `length`-second stretch with the lowest absolute engagement."""
    duration = data.duration_sec or (data.windows[-1].t_end if data.windows else 0.0)
    length = min(length, duration)
    if length <= 0:
        return 0.0, 0.0
    latest = duration - length
    starts = sorted({0.0, latest, *(min(w.t_start, latest) for w in data.windows)})
    scored = [(absolute_score(data.windows, s, s + length), s) for s in starts]
    scored = [(v, s) for v, s in scored if v is not None]
    if not scored:
        return 0.0, round(length, 3)
    _, start = min(scored)
    return round(start, 3), round(start + length, 3)


def attach_scores(data: ActivationData) -> ActivationData:
    """Return activation data with `engagement_score` filled per window (PRD Section 6 response)."""
    curve = build_curve(data)
    for window, score in zip(data.windows, curve.scores):
        window.engagement_score = score.engagement_score
    return data
