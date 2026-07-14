/**
 * M4 search tests: plain-ILIKE substring search over titles and block text,
 * CJK + Latin, title hits ranked before content hits, no JSON-key false
 * positives, deleted pages excluded, ILIKE metacharacters escaped.
 */
import { describe, expect, it } from 'vitest'
import { createDb } from '../src/db/db'
import { createPage, deletePage, savePageBlocks, searchPages } from '../src/db/repo'
import type { BNBlock } from '../src/lib/markdown'

function para(id: string, text: string): BNBlock {
  return { id, type: 'paragraph', content: [{ type: 'text', text, styles: {} }] }
}

describe('searchPages', () => {
  it('finds CJK title and content matches, title hits first', async () => {
    const db = await createDb()
    const byTitle = await createPage(db, { title: '项目计划' })
    const byContent = await createPage(db, { title: 'Notes' })
    await savePageBlocks(db, byContent.id, [
      para(crypto.randomUUID(), '这个项目下周启动'),
    ])

    const hits = await searchPages(db, '项目')
    expect(hits.map((h) => h.pageId)).toEqual([byTitle.id, byContent.id])
    expect(hits[0].matchKind).toBe('title')
    expect(hits[1].matchKind).toBe('content')
    expect(hits[1].snippet).toContain('项目')
  })

  it('matches Latin case-insensitively', async () => {
    const db = await createDb()
    const p = await createPage(db, { title: 'Meeting Agenda' })
    expect((await searchPages(db, 'agenda')).map((h) => h.pageId)).toEqual([p.id])
  })

  it('does not false-positive on BlockNote JSON keys', async () => {
    const db = await createDb()
    const p = await createPage(db, { title: 'A' })
    await savePageBlocks(db, p.id, [para(crypto.randomUUID(), 'hello world')])
    // "paragraph" and "styles" appear in content::text but not in user text
    expect(await searchPages(db, 'paragraph')).toEqual([])
    expect(await searchPages(db, 'styles')).toEqual([])
  })

  it('excludes deleted pages and treats %/_ as literals', async () => {
    const db = await createDb()
    const gone = await createPage(db, { title: '100% done' })
    const kept = await createPage(db, { title: '100_percent' })
    await deletePage(db, gone.id)

    expect(await searchPages(db, '100% done')).toEqual([])
    const hits = await searchPages(db, '100_')
    expect(hits.map((h) => h.pageId)).toEqual([kept.id])
    // "%" alone must not act as match-everything
    expect(await searchPages(db, '%')).toEqual([])
  })

  it('returns [] for empty query and respects limit', async () => {
    const db = await createDb()
    for (let i = 0; i < 5; i++) await createPage(db, { title: `Task ${i}` })
    expect(await searchPages(db, '   ')).toEqual([])
    expect((await searchPages(db, 'Task', 3)).length).toBe(3)
  })
})
