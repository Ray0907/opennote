-- OpenNote schema, migration 003 (M2 outbox capture).
-- Automatic outbox capture: every local INSERT/UPDATE on a replicated table
-- queues a full-row image, so repo.ts (and any future write path) syncs
-- without calling into the sync engine.
--
-- Capture is OPT-IN via the session setting opennote.capture_outbox:
--   * renderer clients enable it in initClientSync,
--   * the sync server never enables it (applyOps must not queue),
--   * syncOnce disables it while applying pulled changes so remote ops do
--     not echo back into the outbox (which would ping-pong forever).

CREATE OR REPLACE FUNCTION opennote_capture_outbox() RETURNS trigger AS $$
BEGIN
  IF COALESCE(current_setting('opennote.capture_outbox', true), 'off') <> 'on' THEN
    RETURN NEW;
  END IF;
  INSERT INTO outbox (op_id, table_name, row_id, row)
  VALUES (gen_random_uuid(), TG_TABLE_NAME, NEW.id, to_jsonb(NEW));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS pages_outbox_capture ON pages;
CREATE TRIGGER pages_outbox_capture
  AFTER INSERT OR UPDATE ON pages
  FOR EACH ROW EXECUTE FUNCTION opennote_capture_outbox();

DROP TRIGGER IF EXISTS blocks_outbox_capture ON blocks;
CREATE TRIGGER blocks_outbox_capture
  AFTER INSERT OR UPDATE ON blocks
  FOR EACH ROW EXECUTE FUNCTION opennote_capture_outbox();
