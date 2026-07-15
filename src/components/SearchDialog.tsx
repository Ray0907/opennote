import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { PGlite } from '@electric-sql/pglite'
import { searchPages, type Page, type SearchHit } from '../db/repo'
import { getRecent } from '../lib/recent'

/**
 * Cmd/Ctrl+K quick-search palette. Queries the repo (title + block text,
 * CJK-safe substring) with a small debounce; Enter / click opens the page.
 * With an empty query it shows recently-opened pages instead of nothing.
 */
export function SearchDialog({
  db,
  pages,
  open,
  onClose,
  onOpenPage,
}: {
  db: PGlite
  pages: Page[]
  open: boolean
  onClose: () => void
  onOpenPage: (pageId: string) => void
}) {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const restoreFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (open) {
      setQuery('')
      setHits([])
      setActive(0)
      // Remember what had focus, then move focus into the dialog.
      restoreFocusRef.current = document.activeElement as HTMLElement | null
      setTimeout(() => inputRef.current?.focus(), 0)
      return () => {
        // Restore focus to the trigger when the dialog closes.
        restoreFocusRef.current?.focus?.()
      }
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const q = query
    const t = setTimeout(() => {
      void searchPages(db, q).then((res) => {
        setHits(res)
        setActive(0)
      })
    }, 120)
    return () => clearTimeout(t)
  }, [db, query, open])

  // Empty query → recently-opened pages (most recent first).
  const recent = useMemo<SearchHit[]>(() => {
    if (!open || query.trim()) return []
    const byId = new Map(pages.map((p) => [p.id, p]))
    return getRecent()
      .map((id) => byId.get(id))
      .filter((p): p is Page => !!p)
      .map((p) => ({ pageId: p.id, title: p.title, matchKind: 'title' as const, snippet: '' }))
  }, [open, query, pages])

  if (!open) return null

  const items = query.trim() ? hits : recent

  const pick = (hit: SearchHit | undefined) => {
    if (!hit) return
    onOpenPage(hit.pageId)
    onClose()
  }

  const activeId = items[active] ? `search-hit-${items[active].pageId}` : undefined

  return (
    <div className="search-overlay" onMouseDown={onClose}>
      <div
        className="search-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Search pages"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          className="search-input"
          placeholder="Search pages…"
          aria-label="Search pages"
          role="combobox"
          aria-expanded={items.length > 0}
          aria-controls="search-results"
          aria-activedescendant={activeId}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose()
            // The input is the only focusable control; trap Tab so focus
            // can't leak to the background behind the modal.
            else if (e.key === 'Tab') e.preventDefault()
            else if (e.key === 'ArrowDown') {
              e.preventDefault()
              setActive((a) => Math.min(a + 1, items.length - 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActive((a) => Math.max(a - 1, 0))
            } else if (e.key === 'Enter') pick(items[active])
          }}
        />
        <ul className="search-results" id="search-results" role="listbox">
          {!query.trim() && items.length > 0 && (
            <li className="search-section" aria-hidden="true">Recent</li>
          )}
          {items.map((h, i) => (
            <li
              key={h.pageId}
              id={`search-hit-${h.pageId}`}
              role="option"
              aria-selected={i === active}
              className={'search-hit' + (i === active ? ' active' : '')}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(h)}
            >
              <span className="search-hit-title">{h.title || 'Untitled'}</span>
              {h.matchKind === 'content' && (
                <span className="search-hit-snippet">{h.snippet}</span>
              )}
            </li>
          ))}
          {query.trim() && hits.length === 0 && (
            <li className="search-empty">No results</li>
          )}
        </ul>
      </div>
    </div>
  )
}
