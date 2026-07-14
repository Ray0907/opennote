import { describe, expect, it } from 'vitest'
import { legacyMirrorPathsToDelete, mirrorPathFor, pageSubtree } from '../src/App'
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
    expect(mirrorPathFor(pages, 'child-id')).toBe('Parent/Child--child-id.md')
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
})
