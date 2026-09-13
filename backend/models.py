"""Pydantic models mirroring the data-handoff contract (PRD Section 2 & 6).

These are the *only* shapes the interface half cares about. The six macro-regions
are the agreed bucketed output of TRIBE v2's ~20k raw cortical vertices.
"""
from __future__ import annotations

from typing import Dict, List, Optional

from pydantic import BaseModel, Field

# The six macro-regions agreed in the handoff contract.
REGION_KEYS = [
    "visual",
    "language",
    "reward_novelty",
    "memory_familiarity",
    "emotional_arousal",
    "attention_salience",
]


class Window(BaseModel):
    t_start: float
    t_end: float
    regions: Dict[str, float]
    # Derived by the engagement curve builder (F2); absent in raw handoff.
    engagement_score: Optional[float] = None
    # Un-normalized TRIBE region means for this window (newer notebook exports).
    raw_regions: Optional[Dict[str, float]] = None


class RegionStats(BaseModel):
    mean: float
    std: float


class ActivationData(BaseModel):
    """Exactly the handoff JSON from PRD Section 2, plus optional derived scores."""

    video_id: str
    duration_sec: float
    windows: List[Window]
    # Per-region mean/std of the raw TRIBE series that `regions` was normalized
    # with (newer notebook exports). Lets another clip be scored on this
    # video's scale - see engagement_curve.rescore_against.
    raw_stats: Optional[Dict[str, RegionStats]] = None


# ---- API request/response models (PRD Section 6) ----


class RedoRequest(BaseModel):
    # Omit both to regenerate the suggested moment (see /regen-options).
    t_start: Optional[float] = Field(None, ge=0)
    t_end: Optional[float] = Field(None, gt=0)


class Candidate(BaseModel):
    candidate_id: str
    preview_url: str
    label: Optional[str] = None
    # Same scale as RedoResponse.baseline_engagement; None when TRIBE hasn't scored it.
    engagement_score: Optional[float] = None
    # Where the score came from, or why there isn't one (candidate_library.take_score).
    score_status: Optional[str] = None
    duration_sec: Optional[float] = None


class SimilarSegment(BaseModel):
    """A past redo whose creative direction resembles this one (E1)."""

    segment_id: str
    similarity: float
    positive_prompt: str
    selected_candidate_id: Optional[str] = None
    engagement_score: Optional[float] = None


class RedoResponse(BaseModel):
    segment_id: str
    positive_prompt: str
    negative_prompt: str
    candidates: List[Candidate]
    t_start: Optional[float] = None
    t_end: Optional[float] = None
    # The original segment's engagement, for before/after on each candidate.
    baseline_engagement: Optional[float] = None
    candidate_source: Optional[str] = None
    # [EXPLORATORY] Empty whenever memory is off, cold, or too slow to matter.
    similar_segments: List[SimilarSegment] = Field(default_factory=list)


class SelectRequest(BaseModel):
    candidate_id: str


class SelectResponse(BaseModel):
    video_id: str
    status: str
    preview_url: str


# ---- Auth (login system, backed by TigerData) ----


class SignupRequest(BaseModel):
    email: str
    password: str = Field(..., min_length=8)


class LoginRequest(BaseModel):
    email: str
    password: str


class UserOut(BaseModel):
    id: int
    email: str
    created_at: str


class AuthResponse(BaseModel):
    token: str
    user: UserOut
