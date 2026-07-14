-- OpenNote schema, migration 004 (M3 databases).
-- Executed identically by PGlite (client cache) and server Postgres (F6).
--
-- Database pages already keep their property schema + view configs in
-- pages.db_schema (001). Rows of a database are ordinary child pages;
-- this migration adds the per-row typed property values (M3). LWW (M2)
-- applies to the whole row, so props replicate with the page.
ALTER TABLE pages ADD COLUMN IF NOT EXISTS props JSONB;
