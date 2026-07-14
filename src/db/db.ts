/**
 * PGlite bootstrap. The same migration files are executed by the server
 * Postgres in M2 (spec F6), so keep everything here plain SQL.
 */
import { PGlite } from '@electric-sql/pglite'
import migration001 from '../../shared/migrations/001_init.sql?raw'
import migration002 from '../../shared/migrations/002_sync.sql?raw'

export const MIGRATIONS: string[] = [migration001, migration002]

/**
 * Create (or open) a database and apply migrations.
 * - No argument: in-memory (tests, browser dev fallback)
 * - 'idb://opennote': persistent IndexedDB store in the Electron renderer.
 *   The local DB is a rebuildable cache; durability comes from the Markdown
 *   mirror and, from M2 on, the sync server (spec F5).
 */
export async function createDb(dataDir?: string): Promise<PGlite> {
  const db = dataDir ? new PGlite(dataDir) : new PGlite()
  for (const migration of MIGRATIONS) {
    await db.exec(migration)
  }
  return db
}
