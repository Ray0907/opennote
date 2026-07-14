/**
 * M4 backlinks index tests: the derived `links` table (005_links.sql) is
 * rebuilt on savePageBlocks and re-resolved on page create/rename/delete.
 */
import { describe, expect, it } from 'vitest'
import { createDb } from '../src/db/db'
import {
  createPage,
  deletePage,
  getBacklinks,
  renamePage,
  savePageBlocks,
} from '../src/db/repo'
import type { BNBlock } from '../src/lib/markdown'

function para(id: string, text: string): BNBlock {
  return { id, type: 'paragraph', content: [{ type: 'text', text, styles: {} }] }
}

describe('backlinks index', () => {
  it('resolves [[Title]] to an existing page and lists the source as a backlink', async () => {
    const db = await createDb()
    const target = await createPage(db, { title: 'Roadmap' })
    const source = await createPage(db, { title: 'Weekly Notes' })
    await savePageBlocks(db, source.id, [para(crypto.randomUUID(), 'see [[Roadmap]]')])

    const back = await getBacklinks(db, target.id)
    expect(back.map((p) => p.id)).toEqual([source.id])
  })

  it('matches titles case-insensitively', async () => {
    const db = await createDb()
    const target = await createPage(db, { title: 'Roadmap' })
    const source = await createPage(db, { title: 'Notes' })
    await savePageBlocks(db, source.id, [para(crypto.randomUUID(), '[[roadmap]]')])

    expect((await getBacklinks(db, target.id)).map((p) => p.id)).toEqual([source.id])
  })

  it('binds a dangling link when a page with that title is created later', async () => {
    const db = await createDb()
    const source = await createPage(db, { title: 'Notes' })
    await savePageBlocks(db, source.id, [para(crypto.randomUUID(), 'todo: [[Roadmap]]')])

    const target = await createPage(db, { title: 'Roadmap' })
    expect((await getBacklinks(db, target.id)).map((p) => p.id)).toEqual([source.id])
  })

  it('rebinds on rename: old target loses the backlink, new title match gains it', async () => {
    const db = await createDb()
    const a = await createPage(db, { title: 'Roadmap' })
    const source = await createPage(db, { title: 'Notes' })
    await savePageBlocks(db, source.id, [para(crypto.randomUUID(), '[[Roadmap]]')])
    expect(await getBacklinks(db, a.id)).toHaveLength(1)

    await renamePage(db, a.id, 'Plan 2027')
    expect(await getBacklinks(db, a.id)).toHaveLength(0)

    // A different page taking the linked title picks the link up.
    const b = await createPage(db, { title: 'Roadmap' })
    expect((await getBacklinks(db, b.id)).map((p) => p.id)).toEqual([source.id])
  })

  it('removing the [[link]] from the document drops the backlink', async () => {
    const db = await createDb()
    const target = await createPage(db, { title: 'Roadmap' })
    const source = await createPage(db, { title: 'Notes' })
    await savePageBlocks(db, source.id, [para(crypto.randomUUID(), '[[Roadmap]]')])
    await savePageBlocks(db, source.id, [para(crypto.randomUUID(), 'link removed')])

    expect(await getBacklinks(db, target.id)).toHaveLength(0)
  })

  it('deleting the source page drops its outgoing links', async () => {
    const db = await createDb()
    const target = await createPage(db, { title: 'Roadmap' })
    const source = await createPage(db, { title: 'Notes' })
    await savePageBlocks(db, source.id, [para(crypto.randomUUID(), '[[Roadmap]]')])

    await deletePage(db, source.id)
    expect(await getBacklinks(db, target.id)).toHaveLength(0)
  })

  it('duplicate titles resolve deterministically to the oldest page', async () => {
    const db = await createDb()
    const first = await createPage(db, { title: 'Roadmap' })
    const second = await createPage(db, { title: 'Roadmap' })
    const source = await createPage(db, { title: 'Notes' })
    await savePageBlocks(db, source.id, [para(crypto.randomUUID(), '[[Roadmap]]')])

    expect(await getBacklinks(db, first.id)).toHaveLength(1)
    expect(await getBacklinks(db, second.id)).toHaveLength(0)
  })
})
