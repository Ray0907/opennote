-- OpenNote schema, migration 005 (M4 wiki links).
-- Executed identically by PGlite (client cache) and server Postgres (F6).
--
-- links is a DERIVED index: each row records that source page's blocks
-- currently contain [[target]]. It is rebuilt locally whenever a page's
-- blocks are saved and is intentionally NOT covered by outbox triggers
-- (003) or SYNC_COLUMNS, so it never syncs and adds no conflict surface.
-- target_page_id is resolved lazily by title; unresolved links keep only
-- target_title so they can bind when a page with that title is created.
CREATE TABLE IF NOT EXISTS links (
  source_page_id UUID NOT NULL,
  target_title   TEXT NOT NULL,
  target_page_id UUID,
  PRIMARY KEY (source_page_id, target_title)
);
CREATE INDEX IF NOT EXISTS links_target_page_idx ON links (target_page_id);
CREATE INDEX IF NOT EXISTS links_target_title_idx ON links (lower(target_title));
