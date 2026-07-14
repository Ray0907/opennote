/**
 * M2 sync core tests: arrival-order LWW, idempotent replay, pull cursor,
 * and two-client convergence — all on in-memory PGlite (same SQL as the
 * server Postgres, F6).
 */
import { describe, expect, it, beforeEach } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb } from '../src/db/db'
import type { SyncOp } from '../shared/sync'
import { upsertRow } from '../shared/sync'
import { applyOps, lastSeq, pullChanges } from '../server/sync'

const P1 = '11111111-1111-4111-8111-111111111111'
const OP = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

function pageOp(opId: string, id: string, title: string, sortKey = 'a0'): SyncOp {
  return {
    opId,
    table: 'pages',
    rowId: id,
    row: {
      id,
      parent_id: null,
      title,
      icon: null,
      sort_key: sortKey,
      is_database: false,
      db_schema: null,
      created_at: new Date('2026-07-14T00:00:00Z').toISOString(),
      updated_at: new Date('2026-07-14T00:00:00Z').toISOString(),
      deleted_at: null,
    },
  }
}

async function titles(db: PGlite): Promise<Array<{ id: string; title: string }>> {
  const res = await db.query<{ id: string; title: string }>(
    'SELECT id, title FROM pages WHERE deleted_at IS NULL ORDER BY id',
  )
  return res.rows
}

describe('sync server core', () => {
  let server: PGlite

  beforeEach(async () => {
    server = await createDb()
  })

  it('stamps increasing server_seq and applies rows', async () => {
    const r1 = await applyOps(server, 'client-a', [pageOp(OP(1), P1, 'hello')])
    expect(r1.applied).toBe(1)
    expect(r1.lastSeq).toBe(1)
    expect(await titles(server)).toEqual([{ id: P1, title: 'hello' }])
  })

  it('resolves conflicts by arrival order, not client clocks', async () => {
    const older = pageOp(OP(1), P1, 'from-a')
    const newer = pageOp(OP(2), P1, 'from-b')
    // Client B's op carries an *older* client timestamp but arrives later.
    newer.row.updated_at = new Date('2026-07-13T00:00:00Z').toISOString()
    await applyOps(server, 'client-a', [older])
    await applyOps(server, 'client-b', [newer])
    expect(await titles(server)).toEqual([{ id: P1, title: 'from-b' }])
  })

  it('is idempotent per op_id (offline replay is safe)', async () => {
    const op = pageOp(OP(1), P1, 'once')
    const r1 = await applyOps(server, 'client-a', [op])
    // Same batch replayed after a "reconnect", plus a mutated duplicate.
    const mutated = { ...op, row: { ...op.row, title: 'should-not-apply' } }
    const r2 = await applyOps(server, 'client-a', [op, mutated])
    expect(r1.lastSeq).toBe(1)
    expect(r2.applied).toBe(0)
    expect(r2.lastSeq).toBe(1)
    expect(await titles(server)).toEqual([{ id: P1, title: 'once' }])
  })

  it('pulls changes after a cursor, excluding own client', async () => {
    await applyOps(server, 'client-a', [pageOp(OP(1), P1, 'v1')])
    await applyOps(server, 'client-b', [pageOp(OP(2), P1, 'v2')])
    const all = await pullChanges(server, 0)
    expect(all.map((c) => c.serverSeq)).toEqual([1, 2])
    const forA = await pullChanges(server, 0, { excludeClient: 'client-a' })
    expect(forA.map((c) => c.opId)).toEqual([OP(2)])
    const afterCursor = await pullChanges(server, 1)
    expect(afterCursor.map((c) => c.serverSeq)).toEqual([2])
    expect(await lastSeq(server)).toBe(2)
  })

  it('soft delete replicates as an update', async () => {
    await applyOps(server, 'client-a', [pageOp(OP(1), P1, 'doomed')])
    const del = pageOp(OP(2), P1, 'doomed')
    del.row.deleted_at = new Date('2026-07-15T00:00:00Z').toISOString()
    await applyOps(server, 'client-a', [del])
    expect(await titles(server)).toEqual([])
    const changes = await pullChanges(server, 1)
    expect(changes).toHaveLength(1)
    expect(changes[0].row.deleted_at).not.toBeNull()
  })

  it('two clients converge after cross-pull', async () => {
    const clientA = await createDb()
    const clientB = await createDb()
    const opA = pageOp(OP(1), P1, 'edited-by-a')
    const opB = pageOp(OP(2), P1, 'edited-by-b')

    // Each client applies its own edit locally, then pushes.
    await upsertRow(clientA, 'pages', opA.row)
    await upsertRow(clientB, 'pages', opB.row)
    await applyOps(server, 'client-a', [opA])
    await applyOps(server, 'client-b', [opB])

    // Convergence rule: apply ALL changes in server_seq order, including
    // your own (re-applying own ops is an idempotent upsert). Skipping own
    // changes would let an earlier remote edit overwrite a later local win.
    for (const db of [clientA, clientB]) {
      for (const change of await pullChanges(server, 0)) {
        await upsertRow(db, change.table, change.row)
      }
    }

    const a = await titles(clientA)
    const b = await titles(clientB)
    const s = await titles(server)
    expect(a).toEqual(s)
    expect(b).toEqual(s)
    expect(s).toEqual([{ id: P1, title: 'edited-by-b' }])
  })
})
