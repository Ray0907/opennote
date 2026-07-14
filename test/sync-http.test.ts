/**
 * M2 HTTP layer tests: the full stack — two PGlite clients syncing through
 * server/http.ts over a real socket (port 0). Verifies the wire protocol,
 * idempotent replay across HTTP, and input validation.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import type { PGlite } from '@electric-sql/pglite'
import { createDb } from '../src/db/db'
import { createSyncServer } from '../server/http'
import { createHttpTransport } from '../src/sync/http'
import { initClientSync, localMutate, syncOnce } from '../src/sync/client'

const P1 = '11111111-1111-4111-8111-111111111111'
const P2 = '22222222-2222-4222-8222-222222222222'

function pageRow(id: string, title: string): Record<string, unknown> {
  const now = new Date('2026-07-14T00:00:00Z').toISOString()
  return {
    id,
    parent_id: null,
    title,
    icon: null,
    sort_key: 'a0',
    is_database: false,
    db_schema: null,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  }
}

async function titles(db: PGlite): Promise<Array<{ id: string; title: string }>> {
  const res = await db.query<{ id: string; title: string }>(
    'SELECT id, title FROM pages WHERE deleted_at IS NULL ORDER BY id',
  )
  return res.rows
}

describe('sync over HTTP', () => {
  let serverDb: PGlite
  let server: Server
  let baseUrl: string

  beforeEach(async () => {
    serverDb = await createDb()
    server = createSyncServer(serverDb)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { address, port } = server.address() as AddressInfo
    baseUrl = `http://${address}:${port}`
  })

  afterEach(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    )
  })

  it('two clients converge through the HTTP server', async () => {
    const a = await createDb()
    const b = await createDb()
    await initClientSync(a, 'client-a')
    await initClientSync(b, 'client-b')
    const ta = createHttpTransport(baseUrl)
    const tb = createHttpTransport(baseUrl)

    await localMutate(a, 'pages', pageRow(P1, 'from-a'))
    await localMutate(b, 'pages', pageRow(P2, 'from-b'))

    const ra1 = await syncOnce(a, ta) // pushes P1, pulls P1
    expect(ra1).toEqual({ pushed: 1, applied: 1, cursor: 1 })
    const rb1 = await syncOnce(b, tb) // pushes P2, pulls P1+P2
    expect(rb1).toEqual({ pushed: 1, applied: 2, cursor: 2 })
    const ra2 = await syncOnce(a, ta) // pulls P2
    expect(ra2).toEqual({ pushed: 0, applied: 1, cursor: 2 })

    const expected = [
      { id: P1, title: 'from-a' },
      { id: P2, title: 'from-b' },
    ]
    expect(await titles(a)).toEqual(expected)
    expect(await titles(b)).toEqual(expected)
    expect(await titles(serverDb)).toEqual(expected)
  })

  it('replaying the same push over HTTP is a no-op (op_id dedupe)', async () => {
    const t = createHttpTransport(baseUrl)
    const op = {
      opId: '00000000-0000-4000-8000-000000000001',
      table: 'pages' as const,
      rowId: P1,
      row: pageRow(P1, 'once'),
    }
    await t.push('client-a', [op])
    await t.push('client-a', [op]) // crash-replay
    expect(await t.pull(0)).toHaveLength(1)
    expect(await titles(serverDb)).toEqual([{ id: P1, title: 'once' }])
  })

  it('rejects malformed input with 400s, not crashes', async () => {
    const bad = await fetch(`${baseUrl}/push`, { method: 'POST', body: 'not json' })
    expect(bad.status).toBe(400)

    const shape = await fetch(`${baseUrl}/push`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clientId: 'c', ops: [{ nope: true }] }),
    })
    expect(shape.status).toBe(400)

    const table = await fetch(`${baseUrl}/push`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        clientId: 'c',
        ops: [{ opId: 'x', table: 'users; DROP TABLE pages', rowId: '1', row: {} }],
      }),
    })
    expect(table.status).toBe(400)

    const since = await fetch(`${baseUrl}/pull?since=-1`)
    expect(since.status).toBe(400)

    expect((await fetch(`${baseUrl}/nope`)).status).toBe(404)
    // Server still healthy afterwards.
    expect(await createHttpTransport(baseUrl).pull(0)).toEqual([])
  })
})
