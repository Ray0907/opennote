import React, { useEffect, useRef, useState } from 'react'
import type { PGlite } from '@electric-sql/pglite'
import { useCreateBlockNote } from '@blocknote/react'
import { BlockNoteView } from '@blocknote/mantine'
import type { PartialBlock } from '@blocknote/core'
import '@blocknote/core/fonts/inter.css'
import '@blocknote/mantine/style.css'
import type { Page } from '../db/repo'
import * as repo from '../db/repo'
import type { BNBlock } from '../lib/markdown'

const SAVE_DEBOUNCE_MS = 500

/** Named cover gradients (M6). Stored in pages.cover by key. */
export const COVERS: Record<string, string> = {
  sunset: 'linear-gradient(135deg, #f6d365 0%, #fda085 100%)',
  ocean: 'linear-gradient(135deg, #667eea 0%, #64b3f4 100%)',
  forest: 'linear-gradient(135deg, #96e6a1 0%, #2f9e44 100%)',
  plum: 'linear-gradient(135deg, #c471f5 0%, #fa71cd 100%)',
  slate: 'linear-gradient(135deg, #868f96 0%, #596164 100%)',
}

const ICON_CHOICES = ['📄', '📝', '📚', '💡', '✅', '📌', '🎯', '🗂️', '🚀', '⭐', '🔧', '🧠']

/** Resolve a stored cover value (gradient key or data URL) to a CSS background. */
export function coverBackground(cover: string): string {
  return COVERS[cover] ?? `url(${cover}) center / cover no-repeat`
}

interface EditorPaneProps {
  db: PGlite
  page: Page
  theme: 'light' | 'dark'
  onRename: (id: string, title: string) => void
  onDocumentSaved: (pageId: string, blocks: BNBlock[]) => Promise<void>
  onSetIcon: (id: string, icon: string | null) => void
  onSetCover: (id: string, cover: string | null) => void
}

/** Loads the page's blocks, then mounts the editor with them. */
export function EditorPane({ db, page, theme, onRename, onDocumentSaved, onSetIcon, onSetCover }: EditorPaneProps) {
  const [initial, setInitial] = useState<PartialBlock[] | 'empty' | null>(null)

  useEffect(() => {
    let cancelled = false
    void repo.getBlocks(db, page.id).then((rows) => {
      if (cancelled) return
      setInitial(rows.length > 0 ? (rows.map((r) => r.content) as PartialBlock[]) : 'empty')
    })
    return () => {
      cancelled = true
    }
  }, [db, page.id])

  if (initial === null) {
    return <div className="editor-loading">Loading…</div>
  }
  return (
    <Editor
      page={page}
      theme={theme}
      initialContent={initial === 'empty' ? undefined : initial}
      onRename={onRename}
      onDocumentSaved={onDocumentSaved}
      onSetIcon={onSetIcon}
      onSetCover={onSetCover}
    />
  )
}

interface EditorProps {
  page: Page
  theme: 'light' | 'dark'
  initialContent: PartialBlock[] | undefined
  onRename: (id: string, title: string) => void
  onDocumentSaved: (pageId: string, blocks: BNBlock[]) => Promise<void>
  onSetIcon: (id: string, icon: string | null) => void
  onSetCover: (id: string, cover: string | null) => void
}

function Editor({ page, theme, initialContent, onRename, onDocumentSaved, onSetIcon, onSetCover }: EditorProps) {
  const editor = useCreateBlockNote({ initialContent })
  const [title, setTitle] = useState(page.title)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Debounced persistence: DB write + mirror write ride the same timer (F4).
  const scheduleSave = () => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      void onDocumentSaved(page.id, editor.document as unknown as BNBlock[])
    }, SAVE_DEBOUNCE_MS)
  }

  useEffect(() => {
    return () => {
      // Flush pending changes when the pane unmounts (page switch).
      if (saveTimer.current) {
        clearTimeout(saveTimer.current)
        void onDocumentSaved(page.id, editor.document as unknown as BNBlock[])
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [iconPickerOpen, setIconPickerOpen] = useState(false)
  const [coverPickerOpen, setCoverPickerOpen] = useState(false)

  return (
    <div className="editor-pane">
      {page.cover && (
        <div className="page-cover" style={{ background: coverBackground(page.cover) }}>
          <div className="page-cover-actions">
            <button onClick={() => setCoverPickerOpen((v) => !v)}>Change cover</button>
            <button onClick={() => onSetCover(page.id, null)}>Remove</button>
          </div>
        </div>
      )}
      <div className="page-header">
        {page.icon && (
          <button
            className="page-icon"
            title="Change icon"
            onClick={() => setIconPickerOpen((v) => !v)}
          >
            {page.icon}
          </button>
        )}
        <div className="page-header-controls">
          {!page.icon && (
            <button className="page-header-add" onClick={() => setIconPickerOpen((v) => !v)}>
              ☺ Add icon
            </button>
          )}
          {!page.cover && (
            <button className="page-header-add" onClick={() => setCoverPickerOpen((v) => !v)}>
              🖼 Add cover
            </button>
          )}
        </div>
        {iconPickerOpen && (
          <div className="icon-picker">
            {ICON_CHOICES.map((emoji) => (
              <button
                key={emoji}
                onClick={() => {
                  onSetIcon(page.id, emoji)
                  setIconPickerOpen(false)
                }}
              >
                {emoji}
              </button>
            ))}
            {page.icon && (
              <button
                className="icon-picker-remove"
                onClick={() => {
                  onSetIcon(page.id, null)
                  setIconPickerOpen(false)
                }}
              >
                Remove
              </button>
            )}
          </div>
        )}
        {coverPickerOpen && (
          <div className="cover-picker">
            {Object.entries(COVERS).map(([key, css]) => (
              <button
                key={key}
                title={key}
                style={{ background: css }}
                onClick={() => {
                  onSetCover(page.id, key)
                  setCoverPickerOpen(false)
                }}
              />
            ))}
          </div>
        )}
        <input
          className="page-title"
          placeholder="Untitled"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => {
            if (title !== page.title) onRename(page.id, title)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }}
        />
      </div>
      <BlockNoteView editor={editor} theme={theme} onChange={scheduleSave} />
    </div>
  )
}
