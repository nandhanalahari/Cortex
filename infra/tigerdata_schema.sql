-- Cortex — TigerData Creative Memory (PRD E1, EXPLORATORY)
--
-- One row per redo attempt: the creative direction Gemini proposed, embedded,
-- plus how that attempt turned out. Similarity search over `embedding` is what
-- lets the redo loop answer "have we tried this before, and did it work?"
--
-- Apply with:  psql "$TIGERDATA_CONNECTION_STRING" -f infra/tigerdata_schema.sql

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS creative_memory (
    id                    BIGSERIAL PRIMARY KEY,
    segment_id            TEXT NOT NULL UNIQUE,
    video_id              TEXT NOT NULL,

    -- 768 dims: matches Gemini text-embedding-004 and the local fallback.
    embedding             VECTOR(768) NOT NULL,
    -- Which embedder produced it. Queries filter on this so vectors from
    -- different models are never compared against each other.
    embed_model           TEXT NOT NULL,

    positive_prompt       TEXT NOT NULL,
    negative_prompt       TEXT NOT NULL,

    -- Outcome, written on /select. NULL = generated but never chosen.
    selected_candidate_id TEXT,
    engagement_score      DOUBLE PRECISION,

    created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cosine index; matches the `<=>` operator used by the search query.
CREATE INDEX IF NOT EXISTS creative_memory_embedding_idx
    ON creative_memory USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS creative_memory_video_idx
    ON creative_memory (video_id);

-- ── Users (login system) ──────────────────────────────────────────────
-- Each signed-in user gets a row here. Every creative_memory write records
-- who made it (nullable: unauthenticated/demo traffic still writes rows,
-- just without an owner) so aggregate stats can be sliced per user later.

CREATE TABLE IF NOT EXISTS users (
    id            BIGSERIAL PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);

ALTER TABLE creative_memory
    ADD COLUMN IF NOT EXISTS user_id BIGINT REFERENCES users(id);

CREATE INDEX IF NOT EXISTS creative_memory_user_idx ON creative_memory (user_id);
