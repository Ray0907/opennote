import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { PGlite } from '@electric-sql/pglite'
import { useCreateBlockNote } from '@blocknote/react'
import { BlockNoteView } from '@blocknote/mantine'
import type { PartialBlock } from '@blocknote/core'
// No Inter import: the editor uses the app's system font stack (One Voice
// Rule) via the --bn-font-family override in styles.css.
import '@blocknote/mantine/style.css'
import type { Page } from '../db/repo'
import * as repo from '../db/repo'
import type { BNBlock } from '../lib/markdown'
import { assertAttachmentSize, attachmentDisplayUrl, getShell } from '../shell'
import { openNoteSchema, ReferenceBlockContext } from './ReferenceBlocks'

const SAVE_DEBOUNCE_MS = 500
const FLUSH_EDITOR_EVENT = 'opennote:flush-editor'

interface FlushEditorDetail {
  pending?: Promise<void>
}

export async function flushOpenEditor(): Promise<void> {
  const detail: FlushEditorDetail = {}
  window.dispatchEvent(new CustomEvent<FlushEditorDetail>(FLUSH_EDITOR_EVENT, { detail }))
  await detail.pending
}

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
export function coverBackground(cover: string, desktop = false): string {
  return COVERS[cover] ?? `url(${attachmentDisplayUrl(cover, desktop)}) center / cover no-repeat`
}

interface EditorPaneProps {
  db: PGlite
  page: Page
  theme: 'light' | 'dark'
  onRename: (id: string, title: string) => void
  onDocumentSaved: (pageId: string, blocks: BNBlock[]) => Promise<void>
  onSetIcon: (id: string, icon: string | null) => void
  onSetCover: (id: string, cover: string | null) => void
  pages: Page[]
  onOpenPage: (id: string) => void
  onCreateSubPage: (parentId: string) => Promise<Page>
  onChanged: () => Promise<unknown>
  onDeleteRow: (id: string) => Promise<void>
  onOpenHistory: () => void
}

/** Loads the page's blocks, then mounts the editor with them. */
export function EditorPane({ db, page, theme, onRename, onDocumentSaved, onSetIcon, onSetCover, pages, onOpenPage, onCreateSubPage, onChanged, onDeleteRow, onOpenHistory }: EditorPaneProps) {
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
      db={db}
      pages={pages}
      onOpenPage={onOpenPage}
      onCreateSubPage={onCreateSubPage}
      onChanged={onChanged}
      onDeleteRow={onDeleteRow}
      onOpenHistory={onOpenHistory}
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
  db: PGlite
  pages: Page[]
  onOpenPage: (id: string) => void
  onCreateSubPage: (parentId: string) => Promise<Page>
  onChanged: () => Promise<unknown>
  onDeleteRow: (id: string) => Promise<void>
  onOpenHistory: () => void
}

function Editor({ page, theme, initialContent, onRename, onDocumentSaved, onSetIcon, onSetCover, db, pages, onOpenPage, onCreateSubPage, onChanged, onDeleteRow, onOpenHistory }: EditorProps) {
  const shell = useMemo(() => getShell(), [])
  const editor = useCreateBlockNote({
    schema: openNoteSchema,
    initialContent: initialContent as never,
    uploadFile: async (file) => {
      assertAttachmentSize(file.size)
      return shell.saveAttachment(file.name, file.type, await file.arrayBuffer())
    },
    resolveFileUrl: async (url) => attachmentDisplayUrl(url, shell.isDesktop),
  })
  const [title, setTitle] = useState(page.title)
  const databases = pages.filter((candidate) => candidate.is_database)
  const [databaseId, setDatabaseId] = useState(databases[0]?.id ?? '')
  const [blockKind, setBlockKind] = useState<'callout' | 'toggle' | 'columns'>('callout')
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved')
  const saveVersion = useRef(0)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveChain = useRef<Promise<void>>(Promise.resolve())
  const dirty = useRef(false)

  const enqueueSave = (version: number, blocks: BNBlock[]) => {
    const persist = () => onDocumentSaved(page.id, blocks)
    const attempt = saveChain.current
      .catch(() => undefined)
      .then(persist)
      .catch(persist)
    saveChain.current = attempt
    void attempt
      .then(() => {
        if (version === saveVersion.current) {
          dirty.current = false
          setSaveState('saved')
        }
      })
      .catch(() => {
        if (version === saveVersion.current) setSaveState('error')
      })
    return attempt
  }

  // Debounced persistence: DB write + mirror write ride the same timer (F4).
  const scheduleSave = () => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    dirty.current = true
    setSaveState('saving')
    const version = ++saveVersion.current
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null
      enqueueSave(version, structuredClone(editor.document) as unknown as BNBlock[])
    }, SAVE_DEBOUNCE_MS)
  }

  useEffect(() => {
    return () => {
      // Flush pending changes when the pane unmounts (page switch).
      if (saveTimer.current) {
        clearTimeout(saveTimer.current)
        saveTimer.current = null
      }
      if (dirty.current) {
        enqueueSave(
          ++saveVersion.current,
          structuredClone(editor.document) as unknown as BNBlock[],
        )
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const flush = (event: Event) => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current)
        saveTimer.current = null
      }
      const version = ++saveVersion.current
      dirty.current = true
      setSaveState('saving')
      ;(event as CustomEvent<FlushEditorDetail>).detail.pending = enqueueSave(
        version,
        structuredClone(editor.document) as unknown as BNBlock[],
      )
    }
    window.addEventListener(FLUSH_EDITOR_EVENT, flush)
    return () => window.removeEventListener(FLUSH_EDITOR_EVENT, flush)
  }, [editor, onDocumentSaved, page.id])

  const [iconPickerOpen, setIconPickerOpen] = useState(false)
  const [coverPickerOpen, setCoverPickerOpen] = useState(false)
  const headerRef = useRef<HTMLDivElement>(null)

  // Dismiss the icon/cover pickers on Escape or an outside click.
  useEffect(() => {
    if (!iconPickerOpen && !coverPickerOpen) return
    const close = () => {
      setIconPickerOpen(false)
      setCoverPickerOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    const onClick = (e: MouseEvent) => {
      if (headerRef.current && !headerRef.current.contains(e.target as Node)) close()
    }
    document.addEventListener('keydown', onKey)
    const id = window.setTimeout(() => document.addEventListener('mousedown', onClick), 0)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onClick)
      window.clearTimeout(id)
    }
  }, [iconPickerOpen, coverPickerOpen])

  return (
    <div className="editor-pane">
      {page.cover && (
        <div className="page-cover" style={{ background: coverBackground(page.cover, shell.isDesktop) }}>
          <div className="page-cover-actions">
            <button onClick={() => setCoverPickerOpen((v) => !v)}>Change cover</button>
            <button onClick={() => onSetCover(page.id, null)}>Remove</button>
          </div>
        </div>
      )}
      <div className="page-header" ref={headerRef}>
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
          <button className="page-header-add" onClick={onOpenHistory}>↶ History</button>
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
                aria-label={`${key} cover`}
                style={{ background: css }}
                onClick={() => {
                  onSetCover(page.id, key)
                  setCoverPickerOpen(false)
                }}
              />
            ))}
            <label className="cover-upload">
              Upload image
              <input
                type="file"
                accept="image/*"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (!file) return
                  try {
                    assertAttachmentSize(file.size)
                    void file.arrayBuffer().then((data) => shell.saveAttachment(file.name, file.type, data)).then((url) => {
                      onSetCover(page.id, url)
                      setCoverPickerOpen(false)
                    }).catch(() => setSaveState('error'))
                  } catch {
                    setSaveState('error')
                  }
                }}
              />
            </label>
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
      <div className="editor-insert-bar" aria-label="Insert blocks">
        <select aria-label="Block type" value={blockKind} onChange={(event) => setBlockKind(event.target.value as typeof blockKind)}>
          <option value="callout">Callout</option>
          <option value="toggle">Toggle</option>
          <option value="columns">2 columns</option>
        </select>
        <button
          onClick={() => {
            const last = editor.document.at(-1)
            if (!last) return
            const next = blockKind === 'callout'
              ? { type: 'callout' as const, props: { icon: '💡' }, content: 'Callout' }
              : blockKind === 'toggle'
                ? {
                    type: 'toggle' as const,
                    content: 'Toggle',
                    children: [{ type: 'paragraph' as const, content: 'Toggle details' }],
                  }
                : {
                    type: 'columns' as const,
                    props: { columns: 2 },
                    children: [
                      { type: 'column' as const, children: [{ type: 'paragraph' as const, content: 'Left column' }] },
                      { type: 'column' as const, children: [{ type: 'paragraph' as const, content: 'Right column' }] },
                    ],
                  }
            editor.insertBlocks([next], last, 'after')
          }}
        >
          + Block
        </button>
        <button
          onClick={() => {
            void onCreateSubPage(page.id).then((child) => {
              const last = editor.document.at(-1)
              if (last) {
                editor.insertBlocks([
                  { type: 'pageLink', props: { pageId: child.id, title: child.title } },
                ], last, 'after')
              }
            })
          }}
        >
          + Sub-page
        </button>
        <select aria-label="Database to embed" value={databaseId} onChange={(event) => setDatabaseId(event.target.value)}>
          {databases.length === 0 && <option value="">No databases</option>}
          {databases.map((database) => (
            <option key={database.id} value={database.id}>{database.title || 'Untitled'}</option>
          ))}
        </select>
        <button
          disabled={!databaseId}
          onClick={() => {
            const database = pages.find((candidate) => candidate.id === databaseId)
            const last = editor.document.at(-1)
            if (database && last) {
              editor.insertBlocks([
                { type: 'databaseView', props: { databaseId, title: database.title } },
              ], last, 'after')
            }
          }}
        >
          + Linked database
        </button>
      </div>
      <div className={`editor-save-status ${saveState}`} role="status">
        {saveState === 'saving' ? 'Saving…' : saveState === 'error' ? 'Save failed' : 'Saved'}
      </div>
      <ReferenceBlockContext.Provider value={{ db, pages, onChanged, onOpenPage, onDeleteRow }}>
        <BlockNoteView editor={editor} theme={theme} onChange={scheduleSave} />
      </ReferenceBlockContext.Provider>
    </div>
  )
}
