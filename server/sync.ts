/**
 * Server-side sync core (M2). Pure logic over a Queryable so it runs
 * identically on PGlite (tests, local dev) and server Postgres (F6).
 *
 * Conflict policy: LWW per row by *arrival order* (F3). Applying an op is
 * simply a full-row upsert; whichever op the server processes last wins.
 * Every applied op is stamped with a monotonically increasing server_seq
 * via the sync_changes log, which is also the pull feed.
 */
import type { Queryable, SyncChange, SyncOp, SyncTable } from '../shared/sync'
import { SYNC_COLUMNS, upsertRow } from '../shared/sync'

export interface ApplyResult {
  /** Highest server_seq after this batch (cursor for the pushing client). */
  lastSeq: number
  /** Number of ops newly applied (duplicates by op_id are skipped). */
  applied: number
}

/** Apply a batch of client ops in arrival order. Idempotent per op_id. */
export async function applyOps(
  db: Queryable,
  clientId: string,
  ops: SyncOp[],
): Promise<ApplyResult> {
  let applied = 0
  for (const op of ops) {
    if (!(op.table in SYNC_COLUMNS)) {
      throw new Error(`unknown sync table: ${op.table}`)
    }
    // Log first; ON CONFLICT DO NOTHING makes replays after reconnect no-ops.
    const logged = await db.query<{ server_seq: string | number }>(
      `INSERT INTO sync_changes (op_id, client_id, table_name, row_id, row)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (op_id) DO NOTHING
       RETURNING server_seq`,
      [op.opId, clientId, op.table, op.rowId, JSON.stringify(op.row)],
    )
    if (logged.rows.length === 0) continue // duplicate replay
    await upsertRow(db, op.table, op.row)
    applied++
  }
  return { lastSeq: await lastSeq(db), applied }
}

/**
 * Changes after sinceSeq, in server_seq order. Cursor = last serverSeq.
 *
 * Convergence rule: clients must apply ALL changes in seq order, including
 * their own (idempotent full-row upserts make that safe). excludeClient is
 * only an optimization for clients that track pending ops (outbox): skipping
 * own changes without that tracking lets an earlier remote edit clobber a
 * later local win.
 */
export async function pullChanges(
  db: Queryable,
  sinceSeq: number,
  opts: { excludeClient?: string; limit?: number } = {},
): Promise<SyncChange[]> {
  const limit = opts.limit ?? 1000
  const params: unknown[] = [sinceSeq]
  let where = 'server_seq > $1'
  if (opts.excludeClient !== undefined) {
    params.push(opts.excludeClient)
    where += ` AND client_id <> $${params.length}`
  }
  params.push(limit)
  const res = await db.query<{
    server_seq: string | number
    op_id: string
    client_id: string
    table_name: string
    row_id: string
    row: Record<string, unknown>
  }>(
    `SELECT server_seq, op_id, client_id, table_name, row_id, row
     FROM sync_changes WHERE ${where}
     ORDER BY server_seq ASC LIMIT $${params.length}`,
    params,
  )
  return res.rows.map((r) => ({
    serverSeq: Number(r.server_seq),
    opId: r.op_id,
    clientId: r.client_id,
    table: r.table_name as SyncTable,
    rowId: r.row_id,
    row: r.row,
  }))
}

/** Highest assigned server_seq (0 when the log is empty). */
export async function lastSeq(db: Queryable): Promise<number> {
  const res = await db.query<{ seq: string | number }>(
    'SELECT COALESCE(MAX(server_seq), 0) AS seq FROM sync_changes',
  )
  return Number(res.rows[0].seq)
}
