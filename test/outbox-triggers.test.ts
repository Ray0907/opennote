/**
 * M2 trigger-capture tests (003_outbox_triggers.sql): plain repo.ts writes
 * queue outbox ops automatically, remote applies do not echo, and the
 * server side never captures.
 */
import { describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb } from '../src/db/db'
import { createPage, renamePage, deletePage, savePageBlocks } from '../src/db/repo'
import { applyOps } from '../server/sync'
import type { SyncTransport } from '../src/sync/client'
import { initClientSync, syncOnce } from '../src/sync/client'

const P1 = '11111111-1111-4111-8111-111111111111'

async function outbox(db: PGlite): Promise<Array<{ table_name: string; row_id: string }>> {
  const res = await db.query<{ table_name: string; row_id: string }>(
    'SELECT table_name, row_id FROM outbox ORDER BY queue_pos',
  )
  return res.rows
}

/** In-process transport: both sides on PGlite, same wiring as sync.test.ts. */
function directTransport(serverDb: PGlite): SyncTransport {
  return {
    push: async (clientId, ops) => void (await applyOps(serverDb, clientId, ops)),
    pull: async (sinceSeq) => {
      const { pullChanges } = await import('../server/sync')
      return pullChanges(serverDb, sinceSeq)
    },
  }
}

describe('trigger-based outbox capture', () => {
  it('captures nothing until initClientSync enables it', async () => {
    const db = await createDb()
    await createPage(db, { parentId: null, title: 'early' })
    expect(await outbox(db)).toEqual([])
  })

  it('queues plain repo.ts writes: create, rename, soft-delete, blocks', async () => {
    const db = await createDb()
    await initClientSync(db, 'client-a')

    const page = await createPage(db, { parentId: null, title: 'hello' })
    await renamePage(db, page.id, 'renamed')
    await savePageBlocks(db, page.id, [
      { id: '22222222-2222-4222-8222-222222222222', type: 'paragraph', content: { text: 'hi' } },
    ])
    await deletePage(db, page.id)

    const queued = await outbox(db)
    // create + rename + block save's page touch + delete on pages, 1 block
    // insert, and the delete's block soft-delete cascade.
    expect(queued.filter((q) => q.table_name === 'pages').length).toBeGreaterThanOrEqual(4)
    expect(queued.filter((q) => q.table_name === 'blocks').length).toBeGreaterThanOrEqual(1)
    // Full-row images: the LAST pages op must carry the deleted_at tombstone.
    const last = await db.query<{ row: { deleted_at: string | null; title: string } }>(
      `SELECT row FROM outbox WHERE table_name = 'pages' ORDER BY queue_pos DESC LIMIT 1`,
    )
    expect(last.rows[0].row.deleted_at).not.toBeNull()
    expect(last.rows[0].row.title).toBe('renamed')
  })

  it('pulled remote changes do not echo into the outbox', async () => {
    const serverDb = await createDb()
    const a = await createDb()
    const b = await createDb()
    await initClientSync(a, 'client-a')
    await initClientSync(b, 'client-b')

    await createPage(a, { parentId: null, title: 'from-a' })
    await syncOnce(a, directTransport(serverDb))

    const rb = await syncOnce(b, directTransport(serverDb)) // b receives the page
    expect(rb.applied).toBeGreaterThan(0)
    expect(await outbox(b)).toEqual([]) // no echo

    // And another cycle on b pushes nothing: the log stays at a's ops only.
    const rb2 = await syncOnce(b, directTransport(serverDb))
    expect(rb2).toMatchObject({ pushed: 0, applied: 0 })
  })

  it('server-side applyOps never captures (capture stays off)', async () => {
    const serverDb = await createDb()
    await applyOps(serverDb, 'client-a', [
      {
        opId: '00000000-0000-4000-8000-000000000001',
        table: 'pages',
        rowId: P1,
        row: {
          id: P1,
          title: 't',
          sort_key: 'a0',
          is_database: false,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
      },
    ])
    expect(await outbox(serverDb)).toEqual([])
  })
})
