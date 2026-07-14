import React, { useEffect, useRef, useState } from 'react'
import type { PGlite } from '@electric-sql/pglite'
import { searchPages, type SearchHit } from '../db/repo'

/**
 * Cmd/Ctrl+K quick-search palette. Queries the repo (title + block text,
 * CJK-safe substring) with a small debounce; Enter / click opens the page.
 */
export function SearchDialog({
  db,
  open,
  onClose,
  onOpenPage,
}: {
  db: PGlite
  open: boolean
  onClose: () => void
  onOpenPage: (pageId: string) => void
}) {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setQuery('')
      setHits([])
      setActive(0)
      // Focus after the dialog renders.
      setTimeout(() => inputRef.current?.focus(), 0)
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

  if (!open) return null

  const pick = (hit: SearchHit | undefined) => {
    if (!hit) return
    onOpenPage(hit.pageId)
    onClose()
  }

  return (
    <div className="search-overlay" onMouseDown={onClose}>
      <div className="search-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="search-input"
          placeholder="Search pages…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose()
            else if (e.key === 'ArrowDown') {
              e.preventDefault()
              setActive((a) => Math.min(a + 1, hits.length - 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActive((a) => Math.max(a - 1, 0))
            } else if (e.key === 'Enter') pick(hits[active])
          }}
        />
        <ul className="search-results">
          {hits.map((h, i) => (
            <li
              key={h.pageId}
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
