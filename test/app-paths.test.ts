import { describe, expect, it } from 'vitest'
import { legacyMirrorPathsToDelete, mirrorPathFor, pageSubtree } from '../src/App'
import * as appHelpers from '../src/App'
import type { Page } from '../src/db/repo'

function page(id: string, title: string, parent_id: string | null): Page {
  return {
    id,
    title,
    parent_id,
    icon: null,
    sort_key: id,
    is_database: false,
    db_schema: null,
    props: null,
    is_favorite: false,
    cover: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

describe('page mirror helpers', () => {
  it('uses the stable page id in the leaf filename to prevent title collisions', () => {
    const pages = [page('parent-id', 'Parent', null), page('child-id', 'Child', 'parent-id')]
    expect(mirrorPathFor(pages, 'child-id')).toBe('Parent--parent-id/Child--child-id.md')
  })

  it('returns a complete subtree in page order', () => {
    const pages = [
      page('root', 'Root', null),
      page('child', 'Child', 'root'),
      page('other', 'Other', null),
      page('grandchild', 'Grandchild', 'child'),
    ]
    expect(pageSubtree(pages, 'root').map((item) => item.id)).toEqual([
      'root',
      'child',
      'grandchild',
    ])
  })

  it('keeps legacy paths that alias another page new mirror', () => {
    const pages = [
      page('page-id', 'Notes', null),
      page('other-id', 'Notes--page-id', null),
    ]

    expect(legacyMirrorPathsToDelete(pages)).toEqual(['Notes.md'])
  })

  it('deletes the prior leaf-only id path when ancestor ids are introduced', () => {
    const pages = [page('parent-id', 'Parent', null), page('child-id', 'Child', 'parent-id')]

    expect(legacyMirrorPathsToDelete(pages)).toEqual([
      'Parent.md',
      'Parent/Child.md',
      'Parent/Child--child-id.md',
    ])
  })
})

describe('page selection', () => {
  it('moves selection to a surviving page when the open page is deleted with its ancestor', () => {
    const nextSelectionAfterDelete = (appHelpers as unknown as {
      nextSelectionAfterDelete?: (
        currentId: string | null,
        deletedPages: Page[],
        remainingPages: Page[],
      ) => string | null
    }).nextSelectionAfterDelete
    const deleted = [page('root', 'Root', null), page('child', 'Child', 'root')]
    const remaining = [page('other', 'Other', null)]

    expect(nextSelectionAfterDelete).toBeTypeOf('function')
    expect(nextSelectionAfterDelete?.('child', deleted, remaining)).toBe('other')
    expect(nextSelectionAfterDelete?.('other', deleted, remaining)).toBe('other')
  })

  it('waits for the open editor to flush before changing pages', async () => {
    const selectAfterFlush = (appHelpers as unknown as {
      selectAfterEditorFlush?: (
        id: string,
        select: (id: string) => void,
        flush: () => Promise<void>,
      ) => Promise<void>
    }).selectAfterEditorFlush
    expect(selectAfterFlush).toBeTypeOf('function')
    if (!selectAfterFlush) return

    let release = () => {}
    const gate = new Promise<void>((resolve) => { release = resolve })
    const events: string[] = []
    const pending = selectAfterFlush(
      'next-page',
      (id) => events.push(`select:${id}`),
      async () => {
        events.push('flush:start')
        await gate
        events.push('flush:end')
      },
    )

    await Promise.resolve()
    expect(events).toEqual(['flush:start'])
    release()
    await pending
    expect(events).toEqual(['flush:start', 'flush:end', 'select:next-page'])
  })
})
