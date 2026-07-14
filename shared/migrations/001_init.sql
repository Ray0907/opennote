-- OpenNote schema, migration 001.
-- Executed identically by PGlite (client cache) and server Postgres (M2, F6).

CREATE TABLE IF NOT EXISTS pages (
  id UUID PRIMARY KEY,
  parent_id UUID,
  title TEXT NOT NULL DEFAULT '',
  icon TEXT,
  -- Fractional ordering key with jitter suffix (F7); sort by (sort_key, id).
  sort_key TEXT NOT NULL,
  is_database BOOLEAN NOT NULL DEFAULT FALSE,
  -- Database pages (M3) keep their property schema + view configs here.
  db_schema JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Soft delete so removals replicate as updates (M2).
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS pages_parent_idx ON pages (parent_id);

-- One row per BlockNote *top-level* block (F2): content stores the full
-- BlockNote block JSON including inline content and nested children.
-- LWW (M2) applies per row.
CREATE TABLE IF NOT EXISTS blocks (
  id UUID PRIMARY KEY,
  page_id UUID NOT NULL,
  sort_key TEXT NOT NULL,
  type TEXT NOT NULL,
  content JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS blocks_page_idx ON blocks (page_id);
