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
import type { SyncTransport } from '../src/sync/client'
import { initClientSync, localMutate, syncOnce } from '../src/sync/client'
import { getBacklinks } from '../src/db/repo'

const P1 = '11111111-1111-4111-8111-111111111111'
const P2 = '22222222-2222-4222-8222-222222222222'
const B1 = '33333333-3333-4333-8333-333333333333'
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

describe('client outbox sync', () => {
  let server: PGlite

  beforeEach(async () => {
    server = await createDb()
  })

  function directTransport(): SyncTransport {
    return {
      push: async (clientId, ops) => {
        await applyOps(server, clientId, ops)
      },
      pull: (sinceSeq) => pullChanges(server, sinceSeq),
    }
  }

  async function newClient(clientId: string): Promise<PGlite> {
    const db = await createDb()
    await initClientSync(db, clientId)
    return db
  }

  it('queues offline edits and drains them on sync', async () => {
    const client = await newClient('client-a')
    await localMutate(client, 'pages', pageOp(OP(1), P1, 'draft').row)
    await localMutate(client, 'pages', { ...pageOp(OP(2), P1, 'final').row })

    // Offline: local db has the edit, server has nothing.
    expect(await titles(client)).toEqual([{ id: P1, title: 'final' }])
    expect(await titles(server)).toEqual([])

    const r = await syncOnce(client, directTransport())
    expect(r.pushed).toBe(2)
    expect(r.cursor).toBe(2)
    expect(await titles(server)).toEqual([{ id: P1, title: 'final' }])
    const outbox = await client.query('SELECT * FROM outbox')
    expect(outbox.rows).toHaveLength(0)
  })

  it('replays safely after a crash between push and outbox delete', async () => {
    const client = await newClient('client-a')
    const op = await localMutate(client, 'pages', pageOp(OP(1), P1, 'once').row)

    // Simulate: push reached the server, then the client crashed before
    // deleting the outbox row — the op is still queued and gets re-pushed.
    await applyOps(server, 'client-a', [op])
    const r = await syncOnce(client, directTransport())

    expect(r.pushed).toBe(1)
    expect(await lastSeq(server)).toBe(1) // deduped by op_id, no new seq
    expect(await titles(client)).toEqual([{ id: P1, title: 'once' }])
    expect(await titles(server)).toEqual([{ id: P1, title: 'once' }])
  })

  it('converges two clients editing the same row through sync cycles', async () => {
    const a = await newClient('client-a')
    const b = await newClient('client-b')
    const t = directTransport()

    await localMutate(a, 'pages', pageOp(OP(1), P1, 'edited-by-a').row)
    await localMutate(b, 'pages', pageOp(OP(2), P1, 'edited-by-b').row)

    await syncOnce(a, t) // a's op -> seq 1
    await syncOnce(b, t) // b's op -> seq 2, b pulls both in order
    await syncOnce(a, t) // a pulls seq 2

    const s = await titles(server)
    expect(s).toEqual([{ id: P1, title: 'edited-by-b' }])
    expect(await titles(a)).toEqual(s)
    expect(await titles(b)).toEqual(s)
  })

  it('lets a pending offline edit win after arriving last', async () => {
    const a = await newClient('client-a')
    const b = await newClient('client-b')
    const t = directTransport()

    // B publishes first; A edits the same row while offline.
    await localMutate(b, 'pages', pageOp(OP(1), P1, 'from-b').row)
    await syncOnce(b, t)
    await localMutate(a, 'pages', pageOp(OP(2), P1, 'from-a-offline').row)

    await syncOnce(a, t) // A's op arrives last -> wins by arrival order
    await syncOnce(b, t)

    const s = await titles(server)
    expect(s).toEqual([{ id: P1, title: 'from-a-offline' }])
    expect(await titles(a)).toEqual(s)
    expect(await titles(b)).toEqual(s)
  })

  function blockOp(opId: string, id: string, pageId: string, text: string): SyncOp {
    return {
      opId,
      table: 'blocks',
      rowId: id,
      row: {
        id,
        page_id: pageId,
        sort_key: 'a0',
        type: 'paragraph',
        content: { id, type: 'paragraph', content: [{ type: 'text', text, styles: {} }] },
        updated_at: new Date('2026-07-14T00:00:00Z').toISOString(),
        deleted_at: null,
      },
    }
  }

  it('rebuilds the links index for pulled block changes (M4 regression)', async () => {
    const a = await newClient('client-a')
    const b = await newClient('client-b')
    const t = directTransport()

    // A creates Target + Notes and links Notes -> [[Target]] in a block.
    await localMutate(a, 'pages', pageOp(OP(1), P1, 'Target').row)
    await localMutate(a, 'pages', pageOp(OP(2), P2, 'Notes', 'a1').row)
    await localMutate(a, 'blocks', blockOp(OP(3), B1, P2, 'see [[Target]]').row)
    await syncOnce(a, t)

    // B pulls all three ops; upsertRow bypasses savePageBlocks, so the
    // links index must be re-derived in syncOnce, not by the writer.
    await syncOnce(b, t)

    const back = await getBacklinks(b, P1)
    expect(back.map((p) => p.id)).toEqual([P2])

    // Pulled rename breaks the binding: link re-resolves to NULL target.
    await localMutate(a, 'pages', pageOp(OP(4), P1, 'Renamed').row)
    await syncOnce(a, t)
    await syncOnce(b, t)
    expect(await getBacklinks(b, P1)).toEqual([])
  })
})
