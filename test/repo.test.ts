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

  it('rejects moving a page into its own subtree', async () => {
    const root = await repo.createPage(db, { title: 'Root' })
    const child = await repo.createPage(db, { parentId: root.id, title: 'Child' })
    await expect(repo.movePage(db, root.id, child.id)).rejects.toThrow('own subtree')
  })

  it('reorders a page before another sibling with one fractional-key update', async () => {
    const a = await repo.createPage(db, { title: 'A' })
    const b = await repo.createPage(db, { title: 'B' })
    const c = await repo.createPage(db, { title: 'C' })
    const before = await repo.listPages(db)

    await repo.reorderPage(db, c.id, b.id)

    const after = await repo.listPages(db)
    expect(after.map((page) => page.id)).toEqual([a.id, c.id, b.id])
    expect(after.find((page) => page.id === a.id)?.sort_key).toBe(
      before.find((page) => page.id === a.id)?.sort_key,
    )
    expect(after.find((page) => page.id === b.id)?.sort_key).toBe(
      before.find((page) => page.id === b.id)?.sort_key,
    )
  })

  it('duplicates page content and decoration with fresh block ids', async () => {
    const source = await repo.createPage(db, { title: 'Source' })
    await repo.setPageIcon(db, source.id, '📄')
    await repo.setPageCover(db, source.id, 'ocean')
    await repo.setPageProps(db, source.id, { owner: 'Ray' })
    await repo.savePageBlocks(db, source.id, [
      para('11111111-1111-4111-8111-111111111111', 'copied text'),
    ])

    const copy = await repo.duplicatePage(db, source.id)
    const copyBlocks = await repo.getBlocks(db, copy.id)

    expect(copy).toMatchObject({ title: 'Source copy', icon: '📄', cover: 'ocean', props: { owner: 'Ray' } })
    expect(copyBlocks[0].id).not.toBe('11111111-1111-4111-8111-111111111111')
    expect((copyBlocks[0].content.content as Array<{ text: string }>)[0].text).toBe('copied text')
  })

  it('duplicates the full subtree and chooses a collision-free copy title', async () => {
    const source = await repo.createPage(db, { title: 'Projects', isDatabase: true })
    const row = await repo.createPage(db, { parentId: source.id, title: 'Launch' })
    const note = await repo.createPage(db, { parentId: row.id, title: 'Brief' })
    await repo.setDbSchema(db, source.id, {
      properties: [{ id: 'related', type: 'relation', relationTarget: source.id }],
      views: [],
    })
    await repo.setPageProps(db, note.id, { related: [row.id] })
    await repo.savePageBlocks(db, note.id, [
      para('11111111-1111-4111-8111-111111111111', 'nested content'),
      {
        id: '22222222-2222-4222-8222-222222222222',
        type: 'pageLink',
        props: { pageId: row.id, title: row.title },
        content: [],
        children: [],
      },
    ])

    const first = await repo.duplicatePage(db, source.id)
    const second = await repo.duplicatePage(db, source.id)
    const pages = await repo.listPages(db)
    const firstRow = pages.find((page) => page.parent_id === first.id)
    const firstNote = pages.find((page) => page.parent_id === firstRow?.id)

    expect(first.title).toBe('Projects copy')
    expect(second.title).toBe('Projects copy 2')
    expect(firstRow?.title).toBe('Launch')
    expect(firstNote?.title).toBe('Brief')
    expect(firstNote && (await repo.getBlocks(db, firstNote.id))[0].content.content).toEqual([
      { type: 'text', text: 'nested content', styles: {} },
    ])
    expect(firstNote?.props).toEqual({ related: [firstRow?.id] })
    expect(first.db_schema).toMatchObject({
      properties: [{ relationTarget: first.id }],
    })
    expect(firstNote && (await repo.getBlocks(db, firstNote.id))[1].content.props).toMatchObject({
      pageId: firstRow?.id,
    })
  })

  it('suffixes duplicate titles even when the source title reaches the filename limit', async () => {
    const source = await repo.createPage(db, { title: 'x'.repeat(120) })
    const first = await repo.duplicatePage(db, source.id)
    const second = await repo.duplicatePage(db, source.id)

    expect(first.title).not.toBe(second.title)
    expect(first.title.length).toBeLessThanOrEqual(120)
    expect(second.title.length).toBeLessThanOrEqual(120)
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
