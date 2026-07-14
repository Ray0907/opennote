/**
 * Client-side sync engine (M2): offline outbox + pull cursor, over the same
 * Queryable surface as the server core so it runs on PGlite unchanged.
 * Tables (outbox, sync_state) are created by shared/migrations/002_sync.sql.
 *
 * Cycle (syncOnce): push outbox -> pull ALL changes since cursor -> apply in
 * server_seq order -> advance cursor. Own ops receive their server_seq during
 * the push, so replaying the full log reproduces server state exactly under
 * arrival-order LWW (see server/sync.ts). Edits made while offline or mid-
 * cycle just queue new outbox ops and win on the next push (later arrival):
 * a pulled change may transiently clobber a newer local edit, but that edit
 * is still queued and re-wins on the next cycle (eventual consistency).
 */
import type { Queryable, SyncChange, SyncOp, SyncTable } from '../../shared/sync'
import { upsertRow } from '../../shared/sync'

/** Transport to the sync server; HTTP in production, direct calls in tests. */
export interface SyncTransport {
  push(clientId: string, ops: SyncOp[]): Promise<void>
  pull(sinceSeq: number): Promise<SyncChange[]>
}

export interface SyncOnceResult {
  pushed: number
  applied: number
  cursor: number
}

/**
 * Persist this client's identity, initialize the pull cursor, and enable
 * automatic outbox capture (003_outbox_triggers.sql) for this connection.
 * Must run before any user write; repo.ts writes made earlier are not queued.
 */
export async function initClientSync(db: Queryable, clientId: string): Promise<void> {
  await db.query(
    `INSERT INTO sync_state (key, value) VALUES ('client_id', $1), ('cursor', '0')
     ON CONFLICT (key) DO NOTHING`,
    [clientId],
  )
  await setCapture(db, 'on')
}

/** Toggle trigger-based outbox capture for this session (client is one PGlite connection). */
async function setCapture(db: Queryable, state: 'on' | 'off'): Promise<void> {
  await db.query(`SELECT set_config('opennote.capture_outbox', $1, false)`, [state])
}

async function getState(db: Queryable, key: string): Promise<string | undefined> {
  const res = await db.query<{ value: string }>(
    'SELECT value FROM sync_state WHERE key = $1',
    [key],
  )
  return res.rows[0]?.value
}

/**
 * Apply a full-row mutation locally; the 003 trigger queues it for the
 * server. Ordinary UI writes need only plain SQL (repo.ts) — the trigger
 * captures those too. Requires initClientSync (capture enabled).
 */
export async function localMutate(
  db: Queryable,
  table: SyncTable,
  row: Record<string, unknown>,
): Promise<SyncOp> {
  await upsertRow(db, table, row)
  const queued = await db.query<{ op_id: string; row: Record<string, unknown> }>(
    'SELECT op_id, row FROM outbox WHERE row_id = $1 ORDER BY queue_pos DESC LIMIT 1',
    [String(row.id)],
  )
  if (queued.rows.length === 0) {
    throw new Error('outbox capture is off — initClientSync has not run')
  }
  return {
    opId: queued.rows[0].op_id,
    table,
    rowId: String(row.id),
    row: queued.rows[0].row,
  }
}

/** One push/pull cycle. Safe to call on a timer; every step is idempotent. */
export async function syncOnce(
  db: Queryable,
  transport: SyncTransport,
): Promise<SyncOnceResult> {
  const clientId = await getState(db, 'client_id')
  if (clientId === undefined) throw new Error('initClientSync has not run')
  let cursor = Number((await getState(db, 'cursor')) ?? '0')

  // 1. Push the outbox snapshot in queue order. If we crash after the server
  //    applies but before the delete, the replay is deduped by op_id.
  const queued = await db.query<{
    queue_pos: string | number
    op_id: string
    table_name: string
    row_id: string
    row: Record<string, unknown>
  }>('SELECT queue_pos, op_id, table_name, row_id, row FROM outbox ORDER BY queue_pos')
  if (queued.rows.length > 0) {
    const ops: SyncOp[] = queued.rows.map((r) => ({
      opId: r.op_id,
      table: r.table_name as SyncTable,
      rowId: r.row_id,
      row: r.row,
    }))
    await transport.push(clientId, ops)
    const maxPos = Number(queued.rows[queued.rows.length - 1].queue_pos)
    await db.query('DELETE FROM outbox WHERE queue_pos <= $1', [maxPos])
  }

  // 2. Pull everything after our cursor (own ops included — see module doc)
  //    and apply in seq order. Capture is off during the apply so pulled
  //    changes do not echo back into the outbox. Caveat: a repo.ts write
  //    that interleaves with this loop on the same connection is not
  //    captured either; the next edit to that row re-queues it, and the
  //    apply window is a few statements long, so the exposure is tiny.
  let applied = 0
  const changes = await transport.pull(cursor)
  await setCapture(db, 'off')
  try {
    for (const change of changes) {
      await upsertRow(db, change.table, change.row)
      cursor = change.serverSeq
      applied++
    }
  } finally {
    await setCapture(db, 'on')
  }
  await db.query(
    `INSERT INTO sync_state (key, value) VALUES ('cursor', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [String(cursor)],
  )

  return { pushed: queued.rows.length, applied, cursor }
}
