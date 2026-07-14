-- OpenNote schema, migration 002 (M2 sync).
-- Executed identically by PGlite (client cache) and server Postgres (F6).
-- The outbox / sync_state tables are only *used* by clients, and
-- sync_changes only by the server, but keeping one migration set on both
-- sides prevents schema drift.

-- Server-side change log. server_seq is the single source of truth for
-- conflict resolution: arrival order wins (spec F3), never client clocks.
CREATE TABLE IF NOT EXISTS sync_changes (
  server_seq BIGSERIAL PRIMARY KEY,
  op_id UUID NOT NULL UNIQUE,          -- idempotency key for replays
  client_id TEXT NOT NULL,
  table_name TEXT NOT NULL,
  row_id UUID NOT NULL,
  row JSONB NOT NULL,                  -- full row image (per-block LWW, F2)
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sync_changes_row_idx
  ON sync_changes (table_name, row_id);

-- Client-side outbox: local writes queued until acked by the server.
CREATE TABLE IF NOT EXISTS outbox (
  queue_pos BIGSERIAL PRIMARY KEY,
  op_id UUID NOT NULL UNIQUE,
  table_name TEXT NOT NULL,
  row_id UUID NOT NULL,
  row JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Client-side sync cursor + identity (key/value).
CREATE TABLE IF NOT EXISTS sync_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
