-- OpenNote schema, migration 006 (M6: favorites + page cover).
-- Executed identically by PGlite (client cache) and server Postgres.

ALTER TABLE pages ADD COLUMN IF NOT EXISTS is_favorite BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE pages ADD COLUMN IF NOT EXISTS cover TEXT;
