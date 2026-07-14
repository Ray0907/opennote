import { beforeEach, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb } from '../src/db/db'
import * as repo from '../src/db/repo'
import type { BNBlock } from '../src/lib/markdown'

function para(id: string, textContent: string): BNBlock {
  return {
    id,
    type: 'paragraph',
    props: {},
    content: [{ type: 'text', text: textContent, styles: {} }],
    children: [],
  }
}

describe('repo', () => {
  let db: PGlite

  beforeEach(async () => {
    db = await createDb() // fresh in-memory database per test
  })

  it('creates pages appended in order', async () => {
    const a = await repo.createPage(db, { title: 'A' })
    const b = await repo.createPage(db, { title: 'B' })
    const c = await repo.createPage(db, { title: 'C' })
    const pages = await repo.listPages(db)
    expect(pages.map((p) => p.id)).toEqual([a.id, b.id, c.id])
  })

  it('builds a tree with parent ids', async () => {
    const root = await repo.createPage(db, { title: 'Root' })
    const child = await repo.createPage(db, { parentId: root.id, title: 'Child' })
    const pages = await repo.listPages(db)
    expect(pages.find((p) => p.id === child.id)?.parent_id).toBe(root.id)
  })

  it('renames a page', async () => {
    const page = await repo.createPage(db, { title: 'Old' })
    await repo.renamePage(db, page.id, 'New')
    expect((await repo.getPage(db, page.id))?.title).toBe('New')
  })

  it('round-trips a block document', async () => {
    const page = await repo.createPage(db, { title: 'Doc' })
    const doc = [para('11111111-1111-4111-8111-111111111111', 'first'),
      para('22222222-2222-4222-8222-222222222222', 'second')]
    await repo.savePageBlocks(db, page.id, doc)
    const rows = await repo.getBlocks(db, page.id)
    expect(rows.map((r) => (r.content.content as Array<{ text: string }>)[0].text)).toEqual([
      'first',
      'second',
    ])
  })

  it('preserves ids and reflects reorders', async () => {
    const page = await repo.createPage(db, { title: 'Doc' })
    const one = para('11111111-1111-4111-8111-111111111111', 'one')
    const two = para('22222222-2222-4222-8222-222222222222', 'two')
    const three = para('33333333-3333-4333-8333-333333333333', 'three')
    await repo.savePageBlocks(db, page.id, [one, two, three])
    const before = await repo.getBlocks(db, page.id)

    // Move "three" to the front.
    await repo.savePageBlocks(db, page.id, [three, one, two])
    const after = await repo.getBlocks(db, page.id)
    expect(after.map((r) => r.id)).toEqual([three.id, one.id, two.id])

    // Stable keys: untouched relative order (one before two) kept their keys.
    const keyOf = (rows: repo.BlockRow[], id: string) =>
      rows.find((r) => r.id === id)!.sort_key
    expect(keyOf(after, one.id)).toBe(keyOf(before, one.id))
    expect(keyOf(after, two.id)).toBe(keyOf(before, two.id))
  })

  it('soft-deletes blocks removed from the document', async () => {
    const page = await repo.createPage(db, { title: 'Doc' })
    const one = para('11111111-1111-4111-8111-111111111111', 'one')
    const two = para('22222222-2222-4222-8222-222222222222', 'two')
    await repo.savePageBlocks(db, page.id, [one, two])
    await repo.savePageBlocks(db, page.id, [two])
    const rows = await repo.getBlocks(db, page.id)
    expect(rows.map((r) => r.id)).toEqual([two.id])
  })

  it('saving an empty document clears the page', async () => {
    const page = await repo.createPage(db, { title: 'Doc' })
    await repo.savePageBlocks(db, page.id, [para('11111111-1111-4111-8111-111111111111', 'x')])
    await repo.savePageBlocks(db, page.id, [])
    expect(await repo.getBlocks(db, page.id)).toEqual([])
  })

  it('soft-deletes a whole subtree with its blocks', async () => {
    const root = await repo.createPage(db, { title: 'Root' })
    const child = await repo.createPage(db, { parentId: root.id, title: 'Child' })
    await repo.savePageBlocks(db, child.id, [
      para('11111111-1111-4111-8111-111111111111', 'nested'),
    ])
    await repo.deletePage(db, root.id)
    const pages = await repo.listPages(db)
    expect(pages.find((p) => p.id === root.id)).toBeUndefined()
    expect(pages.find((p) => p.id === child.id)).toBeUndefined()
    expect(await repo.getBlocks(db, child.id)).toEqual([])
  })

  it('moves a page under a new parent, appended last', async () => {
    const a = await repo.createPage(db, { title: 'A' })
    const b = await repo.createPage(db, { title: 'B' })
    await repo.movePage(db, b.id, a.id)
    const pages = await repo.listPages(db)
    expect(pages.find((p) => p.id === b.id)?.parent_id).toBe(a.id)
  })

  it('CJK content survives the round trip', async () => {
    const page = await repo.createPage(db, { title: '中文頁面' })
    await repo.savePageBlocks(db, page.id, [
      para('11111111-1111-4111-8111-111111111111', '這是一段中文內容'),
    ])
    const rows = await repo.getBlocks(db, page.id)
    expect((rows[0].content.content as Array<{ text: string }>)[0].text).toBe('這是一段中文內容')
  })
})
