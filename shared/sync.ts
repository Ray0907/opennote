/**
 * Sync protocol types shared by client and server (M2).
 *
 * Every mutation is a full-row upsert ("put"): soft deletes replicate as
 * updates with deleted_at set (spec: removals replicate as updates), and
 * per-block LWW applies to the whole row (F2). Arrival order at the server
 * decides conflicts via server_seq (F3); client timestamps are display-only.
 */

export type SyncTable = 'pages' | 'blocks'

/** A single idempotent mutation. opId dedupes replays after reconnect. */
export interface SyncOp {
  opId: string
  table: SyncTable
  rowId: string
  /** Full row image, column name -> JSON-serializable value. */
  row: Record<string, unknown>
}

/** A server-acknowledged change, as returned by pull. */
export interface SyncChange extends SyncOp {
  serverSeq: number
  clientId: string
}

/** Minimal query surface satisfied by both PGlite and pg clients. */
export interface Queryable {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>
}

/** Columns replicated for each table; must match shared/migrations. */
export const SYNC_COLUMNS: Record<SyncTable, string[]> = {
  pages: [
    'id',
    'parent_id',
    'title',
    'icon',
    'sort_key',
    'is_database',
    'db_schema',
    'props',
    'is_favorite',
    'cover',
    'created_at',
    'updated_at',
    'deleted_at',
  ],
  blocks: ['id', 'page_id', 'sort_key', 'type', 'content', 'updated_at', 'deleted_at'],
}

/** JSONB columns that must be serialized when bound as parameters. */
const JSONB_COLUMNS = new Set(['db_schema', 'props', 'content'])

/**
 * Upsert a full row image into pages/blocks. Overwrites every replicated
 * column present in the payload: last write applied wins (LWW by arrival
 * order). Columns *missing* from the payload (e.g. a row image from an older
 * client that predates a migration) are skipped entirely so column defaults
 * apply on insert and existing values are preserved on update — an absent key
 * must never be coerced to an explicit NULL.
 */
export async function upsertRow(
  db: Queryable,
  table: SyncTable,
  row: Record<string, unknown>,
): Promise<void> {
  const cols = SYNC_COLUMNS[table].filter((c) => row[c] !== undefined)
  if (!cols.includes('id')) {
    throw new Error(`sync row for ${table} is missing id`)
  }
  const params = cols.map((c) => {
    const v = row[c]
    if (JSONB_COLUMNS.has(c) && v !== null) return JSON.stringify(v)
    return v
  })
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ')
  const updates = cols
    .filter((c) => c !== 'id')
    .map((c) => `${c} = EXCLUDED.${c}`)
    .join(', ')
  const conflict = updates.length > 0 ? `DO UPDATE SET ${updates}` : 'DO NOTHING'
  await db.query(
    `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})
     ON CONFLICT (id) ${conflict}`,
    params,
  )
}
