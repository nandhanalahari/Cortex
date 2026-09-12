"""E1: TigerData Creative Memory (PRD Section 3 & 5).

Stores the *creative direction* of every redo attempt (Gemini's prompt pair)
as an embedding alongside its outcome (which candidate the user picked, what
the segment scored). On the next redo, Cortex asks TigerData "have we tried
something like this before, and how did it go?" so regenerations aren't blind.

Three hard rules, because this is EXPLORATORY sitting in a CORE path:
  1. Nothing here raises into the redo flow. Every entry point returns a safe
     default on failure.
  2. No TigerData configured -> in-memory fallback, so the demo runs with zero
     infra (PRD Section 11: full offline fallback).
  3. The lookup never blocks candidate generation - the route runs it in a
     thread alongside ElevenLabs and collects it with a timeout.
"""
from __future__ import annotations

import hashlib
import math
import re
import threading
from concurrent.futures import Future, TimeoutError as FutureTimeout
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import List, Optional

from ..config import settings

EMBED_DIM = 768
_TOKEN_RE = re.compile(r"[a-z0-9]+")


@dataclass
class SimilarSegmentHit:
    segment_id: str
    similarity: float
    positive_prompt: str
    selected_candidate_id: Optional[str]
    engagement_score: Optional[float]


# ── Embedding ────────────────────────────────────────────────────────────
# Two backends that must never be mixed in one similarity query, so every row
# records which produced it and queries filter on it.


def _local_embed(text: str) -> List[float]:
    """Deterministic hashing-trick embedding. No API, real lexical similarity."""
    vec = [0.0] * EMBED_DIM
    for token in _TOKEN_RE.findall(text.lower()):
        h = int.from_bytes(hashlib.blake2b(token.encode(), digest_size=8).digest(), "big")
        # Signed hashing trick: second bit decides direction, cancels collisions.
        vec[h % EMBED_DIM] += 1.0 if (h >> 1) & 1 else -1.0
    norm = math.sqrt(sum(v * v for v in vec))
    return [v / norm for v in vec] if norm > 0 else vec


def _embed(text: str) -> tuple[List[float], str]:
    """Return (vector, model_tag). Falls back to local on any failure."""
    if settings.OFFLINE_MODE or not settings.GEMINI_API_KEY:
        return _local_embed(text), "local_hash_v1"
    try:
        from google import genai

        client = genai.Client(api_key=settings.GEMINI_API_KEY)
        resp = client.models.embed_content(
            model=settings.GEMINI_EMBED_MODEL, contents=text
        )
        values = list(resp.embeddings[0].values)
        if len(values) != EMBED_DIM:
            raise ValueError(
                f"expected {EMBED_DIM}-dim embedding, got {len(values)}"
            )
        return values, settings.GEMINI_EMBED_MODEL
    except Exception as exc:  # noqa: BLE001 - demo resilience over strictness
        print(f"[memory] embedding fell back to local: {exc}")
        return _local_embed(text), "local_hash_v1"


def _direction_text(positive_prompt: str, negative_prompt: str) -> str:
    return f"DO: {positive_prompt}\nAVOID: {negative_prompt}"


def _cosine(a: List[float], b: List[float]) -> float:
    return sum(x * y for x, y in zip(a, b))  # both sides are L2-normalized


# ── In-memory fallback store ─────────────────────────────────────────────


@dataclass
class _MemoryRow:
    segment_id: str
    video_id: str
    embedding: List[float]
    embed_model: str
    positive_prompt: str
    negative_prompt: str
    selected_candidate_id: Optional[str] = None
    engagement_score: Optional[float] = None
    # Who made this attempt, if signed in. Purely for aggregate analytics -
    # search stays cross-user, since a fix that worked on someone else's ad
    # is still a fix worth surfacing (PRD Section 3, E1).
    user_id: Optional[int] = None


class _InMemoryBackend:
    def __init__(self) -> None:
        self._rows: List[_MemoryRow] = []
        self._lock = threading.Lock()

    def write(self, row: _MemoryRow) -> None:
        with self._lock:
            self._rows = [r for r in self._rows if r.segment_id != row.segment_id]
            self._rows.append(row)

    def search(
        self, embedding: List[float], embed_model: str, limit: int
    ) -> List[SimilarSegmentHit]:
        with self._lock:
            rows = [r for r in self._rows if r.embed_model == embed_model]
        scored = [(_cosine(embedding, r.embedding), r) for r in rows]
        scored.sort(key=lambda pair: pair[0], reverse=True)
        return [
            SimilarSegmentHit(
                segment_id=r.segment_id,
                similarity=round(sim, 4),
                positive_prompt=r.positive_prompt,
                selected_candidate_id=r.selected_candidate_id,
                engagement_score=r.engagement_score,
            )
            for sim, r in scored[:limit]
        ]

    def set_outcome(
        self, segment_id: str, candidate_id: Optional[str], score: Optional[float]
    ) -> None:
        with self._lock:
            for r in self._rows:
                if r.segment_id == segment_id:
                    r.selected_candidate_id = candidate_id
                    r.engagement_score = score
                    return


_fallback = _InMemoryBackend()


# ── TigerData (Postgres + pgvector) ──────────────────────────────────────
# A fresh connection per operation: at demo volume the ~50ms cost is noise
# next to an ElevenLabs call, and it sidesteps every stale-connection bug.


def _vector_literal(vec: List[float]) -> str:
    return "[" + ",".join(f"{v:.6f}" for v in vec) + "]"


def _connect():
    import psycopg

    return psycopg.connect(settings.TIGERDATA_CONNECTION_STRING, connect_timeout=5)


def enabled() -> bool:
    return bool(settings.TIGERDATA_CONNECTION_STRING)


def _pg_write(row: _MemoryRow) -> None:
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO creative_memory
                (segment_id, video_id, embedding, embed_model,
                 positive_prompt, negative_prompt, user_id, created_at)
            VALUES (%s, %s, %s::vector, %s, %s, %s, %s, %s)
            ON CONFLICT (segment_id) DO UPDATE SET
                embedding = EXCLUDED.embedding,
                embed_model = EXCLUDED.embed_model,
                positive_prompt = EXCLUDED.positive_prompt,
                negative_prompt = EXCLUDED.negative_prompt,
                user_id = EXCLUDED.user_id
            """,
            (
                row.segment_id,
                row.video_id,
                _vector_literal(row.embedding),
                row.embed_model,
                row.positive_prompt,
                row.negative_prompt,
                row.user_id,
                datetime.now(timezone.utc),
            ),
        )


def _pg_search(
    embedding: List[float], embed_model: str, limit: int
) -> List[SimilarSegmentHit]:
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT segment_id,
                   1 - (embedding <=> %s::vector) AS similarity,
                   positive_prompt,
                   selected_candidate_id,
                   engagement_score
            FROM creative_memory
            WHERE embed_model = %s
            ORDER BY embedding <=> %s::vector
            LIMIT %s
            """,
            (_vector_literal(embedding), embed_model, _vector_literal(embedding), limit),
        )
        return [
            SimilarSegmentHit(
                segment_id=r[0],
                similarity=round(float(r[1]), 4),
                positive_prompt=r[2],
                selected_candidate_id=r[3],
                engagement_score=float(r[4]) if r[4] is not None else None,
            )
            for r in cur.fetchall()
        ]


def _pg_set_outcome(
    segment_id: str, candidate_id: Optional[str], score: Optional[float]
) -> None:
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            UPDATE creative_memory
            SET selected_candidate_id = %s, engagement_score = %s
            WHERE segment_id = %s
            """,
            (candidate_id, score, segment_id),
        )


# ── Public API (never raises) ────────────────────────────────────────────


def find_similar(positive_prompt: str, negative_prompt: str) -> List[SimilarSegmentHit]:
    """Past segments whose creative direction resembles this one.

    Deliberately not scoped to one video: a direction that flopped on another
    ad is exactly the lesson worth carrying over.
    """
    try:
        embedding, model = _embed(_direction_text(positive_prompt, negative_prompt))
        limit = settings.MEMORY_TOP_K
        if enabled():
            try:
                return _pg_search(embedding, model, limit)
            except Exception as exc:  # noqa: BLE001
                print(f"[memory] TigerData search failed, using local: {exc}")
        return _fallback.search(embedding, model, limit)
    except Exception as exc:  # noqa: BLE001
        print(f"[memory] find_similar failed, returning none: {exc}")
        return []


def remember(
    segment_id: str,
    video_id: str,
    positive_prompt: str,
    negative_prompt: str,
    user_id: Optional[int] = None,
) -> None:
    """Record this redo attempt's creative direction. Outcome lands later.

    `user_id` is None for anonymous/demo traffic - the row is still written,
    just without an owner to aggregate by.
    """
    try:
        embedding, model = _embed(_direction_text(positive_prompt, negative_prompt))
        row = _MemoryRow(
            segment_id=segment_id,
            video_id=video_id,
            embedding=embedding,
            embed_model=model,
            positive_prompt=positive_prompt,
            negative_prompt=negative_prompt,
            user_id=user_id,
        )
        _fallback.write(row)  # always, so a later DB outage still has history
        if enabled():
            try:
                _pg_write(row)
            except Exception as exc:  # noqa: BLE001
                print(f"[memory] TigerData write failed (kept locally): {exc}")
    except Exception as exc:  # noqa: BLE001
        print(f"[memory] remember failed: {exc}")


def record_outcome(
    segment_id: str, candidate_id: Optional[str], engagement_score: Optional[float]
) -> None:
    """Close the loop: which candidate won, and what that stretch scored."""
    try:
        _fallback.set_outcome(segment_id, candidate_id, engagement_score)
        if enabled():
            try:
                _pg_set_outcome(segment_id, candidate_id, engagement_score)
            except Exception as exc:  # noqa: BLE001
                print(f"[memory] TigerData outcome update failed: {exc}")
    except Exception as exc:  # noqa: BLE001
        print(f"[memory] record_outcome failed: {exc}")


def collect_similar(future: "Future[List[SimilarSegmentHit]]") -> List[SimilarSegmentHit]:
    """Harvest the parallel lookup. A slow memory never delays candidates."""
    try:
        return future.result(timeout=settings.MEMORY_LOOKUP_TIMEOUT_SEC)
    except FutureTimeout:
        print("[memory] similarity lookup timed out; returning candidates without it")
        return []
    except Exception as exc:  # noqa: BLE001
        print(f"[memory] similarity lookup failed: {exc}")
        return []
