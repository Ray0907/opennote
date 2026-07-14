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

interface EditorPaneProps {
  db: PGlite
  page: Page
  onRename: (id: string, title: string) => void
  onDocumentSaved: (pageId: string, blocks: BNBlock[]) => Promise<void>
}

/** Loads the page's blocks, then mounts the editor with them. */
export function EditorPane({ db, page, onRename, onDocumentSaved }: EditorPaneProps) {
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
      initialContent={initial === 'empty' ? undefined : initial}
      onRename={onRename}
      onDocumentSaved={onDocumentSaved}
    />
  )
}

interface EditorProps {
  page: Page
  initialContent: PartialBlock[] | undefined
  onRename: (id: string, title: string) => void
  onDocumentSaved: (pageId: string, blocks: BNBlock[]) => Promise<void>
}

function Editor({ page, initialContent, onRename, onDocumentSaved }: EditorProps) {
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

  return (
    <div className="editor-pane">
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
      <BlockNoteView editor={editor} theme="light" onChange={scheduleSave} />
    </div>
  )
}
