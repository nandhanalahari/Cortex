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

from dataclasses import dataclass
from typing import List

from ..models import REGION_KEYS, ActivationData

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


def attach_scores(data: ActivationData) -> ActivationData:
    """Return activation data with `engagement_score` filled per window (PRD Section 6 response)."""
    curve = build_curve(data)
    for window, score in zip(data.windows, curve.scores):
        window.engagement_score = score.engagement_score
    return data
