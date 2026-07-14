/**
 * M6 trash/restore + favorites tests: deletePage soft-deletes a subtree with a
 * single timestamp; restorePage brings back exactly that subtree, reparents to
 * top level when the original parent is still trashed, and re-derives links.
 */
import { describe, expect, it } from 'vitest'
import { createDb } from '../src/db/db'
import {
  createPage,
  deletePage,
  getBacklinks,
  getBlocks,
  getPage,
  listFavorites,
  listPages,
  listTrash,
  restorePage,
  savePageBlocks,
  setFavorite,
  setPageCover,
  setPageIcon,
} from '../src/db/repo'
import type { BNBlock } from '../src/lib/markdown'

function para(id: string, text: string): BNBlock {
  return { id, type: 'paragraph', content: [{ type: 'text', text, styles: {} }] }
}

describe('trash & restore', () => {
  it('restores a deleted page with its blocks', async () => {
    const db = await createDb()
    const page = await createPage(db, { title: 'Notes' })
    await savePageBlocks(db, page.id, [para(crypto.randomUUID(), 'hello')])

    await deletePage(db, page.id)
    expect(await getPage(db, page.id)).toBeNull()
    expect((await listTrash(db)).map((p) => p.id)).toEqual([page.id])

    await restorePage(db, page.id)
    expect((await getPage(db, page.id))?.title).toBe('Notes')
    expect(await listTrash(db)).toEqual([])
    expect((await getBlocks(db, page.id)).length).toBe(1)
  })

  it('restores the whole subtree deleted in one operation', async () => {
    const db = await createDb()
    const root = await createPage(db, { title: 'Root' })
    const child = await createPage(db, { parentId: root.id, title: 'Child' })
    const grand = await createPage(db, { parentId: child.id, title: 'Grand' })

    await deletePage(db, root.id)
    // Only the root shows in trash, not each descendant.
    expect((await listTrash(db)).map((p) => p.id)).toEqual([root.id])

    await restorePage(db, root.id)
    const ids = (await listPages(db)).map((p) => p.id)
    expect(ids).toContain(root.id)
    expect(ids).toContain(child.id)
    expect(ids).toContain(grand.id)
  })

  it('leaves a previously-trashed descendant in the trash on restore', async () => {
    const db = await createDb()
    const root = await createPage(db, { title: 'Root' })
    const child = await createPage(db, { parentId: root.id, title: 'Child' })

    await deletePage(db, child.id) // separate, earlier delete
    await deletePage(db, root.id)
    await restorePage(db, root.id)

    expect(await getPage(db, root.id)).not.toBeNull()
    expect(await getPage(db, child.id)).toBeNull()
    expect((await listTrash(db)).map((p) => p.id)).toEqual([child.id])
  })

  it('restoring a child whose parent is still trashed moves it to top level', async () => {
    const db = await createDb()
    const root = await createPage(db, { title: 'Root' })
    const child = await createPage(db, { parentId: root.id, title: 'Child' })

    await deletePage(db, child.id)
    await deletePage(db, root.id)
    await restorePage(db, child.id)

    const restored = await getPage(db, child.id)
    expect(restored?.parent_id).toBeNull()
    expect((await listTrash(db)).map((p) => p.id)).toEqual([root.id])
  })

  it('re-derives outgoing links after restore', async () => {
    const db = await createDb()
    const target = await createPage(db, { title: 'Roadmap' })
    const source = await createPage(db, { title: 'Notes' })
    await savePageBlocks(db, source.id, [para(crypto.randomUUID(), 'see [[Roadmap]]')])

    await deletePage(db, source.id)
    expect(await getBacklinks(db, target.id)).toEqual([])

    await restorePage(db, source.id)
    expect((await getBacklinks(db, target.id)).map((p) => p.id)).toEqual([source.id])
  })
})

describe('favorites & page decoration', () => {
  it('setFavorite toggles and listFavorites excludes trashed pages', async () => {
    const db = await createDb()
    const a = await createPage(db, { title: 'A' })
    const b = await createPage(db, { title: 'B' })
    await setFavorite(db, a.id, true)
    await setFavorite(db, b.id, true)
    expect((await listFavorites(db)).map((p) => p.id)).toEqual([a.id, b.id])

    await setFavorite(db, b.id, false)
    expect((await listFavorites(db)).map((p) => p.id)).toEqual([a.id])

    await deletePage(db, a.id)
    expect(await listFavorites(db)).toEqual([])
  })

  it('sets and clears icon and cover', async () => {
    const db = await createDb()
    const page = await createPage(db, { title: 'Decorated' })
    await setPageIcon(db, page.id, '🚀')
    await setPageCover(db, page.id, 'gradient-1')
    let got = await getPage(db, page.id)
    expect(got?.icon).toBe('🚀')
    expect(got?.cover).toBe('gradient-1')

    await setPageIcon(db, page.id, null)
    await setPageCover(db, page.id, null)
    got = await getPage(db, page.id)
    expect(got?.icon).toBeNull()
    expect(got?.cover).toBeNull()
  })
})
