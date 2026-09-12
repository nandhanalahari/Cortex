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


class ActivationData(BaseModel):
    """Exactly the handoff JSON from PRD Section 2, plus optional derived scores."""

    video_id: str
    duration_sec: float
    windows: List[Window]


# ---- API request/response models (PRD Section 6) ----


class RedoRequest(BaseModel):
    t_start: float = Field(..., ge=0)
    t_end: float = Field(..., gt=0)


class Candidate(BaseModel):
    candidate_id: str
    preview_url: str


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
