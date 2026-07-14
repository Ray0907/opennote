import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PGlite } from '@electric-sql/pglite'
import type { Page } from './db/repo'
import * as repo from './db/repo'
import { getShell } from './shell'
import { markdownToPage, pageToMarkdown, sanitizeFileName, type BNBlock } from './lib/markdown'
import { Sidebar } from './components/Sidebar'
import { SearchDialog } from './components/SearchDialog'
import { EditorPane } from './components/EditorPane'
import { DatabaseView } from './components/DatabaseView'
import { createDefaultSchema } from './lib/database'

/** Vault-relative mirror path: nested folders following the page tree. */
export function mirrorPathFor(pages: Page[], pageId: string): string {
  const byId = new Map(pages.map((p) => [p.id, p]))
  const segments: string[] = []
  let current = byId.get(pageId)
  while (current) {
    segments.unshift(sanitizeFileName(current.title))
    current = current.parent_id ? byId.get(current.parent_id) : undefined
  }
  return segments.join('/') + '.md'
}

export function App({ db }: { db: PGlite }) {
  const [pages, setPages] = useState<Page[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  // Last mirror path per page, so renames/moves clean up their old file.
  const mirrorPaths = useRef(new Map<string, string>())
  const shell = useMemo(() => getShell(), [])

  const refreshPages = useCallback(async () => {
    const next = await repo.listPages(db)
    setPages(next)
    return next
  }, [db])

  useEffect(() => {
    void refreshPages().then((loaded) => {
      if (loaded.length > 0) setSelectedId((cur) => cur ?? loaded[0].id)
    })
  }, [refreshPages])

  // Remote sync applied changes (main.tsx loop): refresh the page tree.
  // The open editor keeps local state until the page is reopened — a pulled
  // remote edit to the *open* page surfaces on next selection (known M2
  // limit; live editor merge is out of scope until later milestones).
  useEffect(() => {
    const onRemote = () => void refreshPages()
    window.addEventListener('opennote:remote-change', onRemote)
    return () => window.removeEventListener('opennote:remote-change', onRemote)
  }, [refreshPages])

  // Cmd/Ctrl+K opens quick search from anywhere (including the editor).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearchOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const mirrorPage = useCallback(
    async (allPages: Page[], pageId: string, blocks: BNBlock[]) => {
      const page = allPages.find((p) => p.id === pageId)
      if (!page) return
      const relPath = mirrorPathFor(allPages, pageId)
      const previous = mirrorPaths.current.get(pageId)
      if (previous && previous !== relPath) {
        await shell.deleteMirror(previous)
      }
      mirrorPaths.current.set(pageId, relPath)
      await shell.writeMirror(relPath, pageToMarkdown(page, blocks))
    },
    [shell],
  )

  const handleCreate = useCallback(
    async (parentId: string | null) => {
      const page = await repo.createPage(db, { parentId, title: 'Untitled' })
      const next = await refreshPages()
      setSelectedId(page.id)
      await mirrorPage(next, page.id, [])
    },
    [db, refreshPages, mirrorPage],
  )

  const handleCreateDatabase = useCallback(async () => {
    const page = await repo.createPage(db, { parentId: null, title: 'New database', isDatabase: true })
    await repo.setDbSchema(db, page.id, createDefaultSchema())
    await refreshPages()
    setSelectedId(page.id)
  }, [db, refreshPages])

  const handleRename = useCallback(
    async (id: string, title: string) => {
      await repo.renamePage(db, id, title)
      const next = await refreshPages()
      const blocks = (await repo.getBlocks(db, id)).map((r) => r.content)
      await mirrorPage(next, id, blocks)
    },
    [db, refreshPages, mirrorPage],
  )

  const handleDelete = useCallback(
    async (id: string) => {
      await repo.deletePage(db, id)
      const relPath = mirrorPaths.current.get(id)
      if (relPath) {
        await shell.deleteMirror(relPath)
        mirrorPaths.current.delete(id)
      }
      const next = await refreshPages()
      setSelectedId((cur) => (cur === id ? (next[0]?.id ?? null) : cur))
    },
    [db, refreshPages, shell],
  )

  const handleDocumentSaved = useCallback(
    async (pageId: string, blocks: BNBlock[]) => {
      await repo.savePageBlocks(db, pageId, blocks)
      await mirrorPage(pages, pageId, blocks)
    },
    [db, pages, mirrorPage],
  )

  const selectedPage = pages.find((p) => p.id === selectedId) ?? null

  /** M4 export: current (non-database) page → .md via the shell save dialog. */
  const handleExport = useCallback(async () => {
    if (!selectedPage || selectedPage.is_database) return
    const blocks = (await repo.getBlocks(db, selectedPage.id)).map((r) => r.content)
    await shell.exportMarkdown(
      `${sanitizeFileName(selectedPage.title)}.md`,
      pageToMarkdown(selectedPage, blocks),
    )
  }, [db, shell, selectedPage])

  /** M4 import: .md files → new top-level pages (title from front-matter/H1). */
  const handleImport = useCallback(async () => {
    const files = await shell.importMarkdown()
    if (!files || files.length === 0) return
    let lastId: string | null = null
    for (const file of files) {
      const fallback = file.name.replace(/\.(md|markdown|txt)$/i, '') || 'Imported page'
      const { title, blocks } = markdownToPage(file.content, fallback)
      const page = await repo.createPage(db, { parentId: null, title })
      await repo.savePageBlocks(db, page.id, blocks)
      lastId = page.id
    }
    const next = await refreshPages()
    if (lastId) {
      setSelectedId(lastId)
      const blocks = (await repo.getBlocks(db, lastId)).map((r) => r.content)
      await mirrorPage(next, lastId, blocks)
    }
  }, [db, shell, refreshPages, mirrorPage])

  return (
    <div className="app">
      <Sidebar
        pages={pages}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onCreate={handleCreate}
        onCreateDatabase={() => void handleCreateDatabase()}
        onDelete={handleDelete}
        onImport={() => void handleImport()}
        onExport={
          selectedPage && !selectedPage.is_database ? () => void handleExport() : null
        }
      />
      <main className="editor-area">
        {selectedPage?.is_database ? (
          <div className="editor-pane">
            <input
              className="page-title"
              defaultValue={selectedPage.title}
              placeholder="Untitled"
              onBlur={(e) => {
                if (e.target.value !== selectedPage.title) void handleRename(selectedPage.id, e.target.value)
              }}
            />
            <DatabaseView
              key={selectedPage.id}
              db={db}
              page={selectedPage}
              pages={pages}
              onChanged={refreshPages}
              onOpenRow={setSelectedId}
            />
          </div>
        ) : selectedPage ? (
          <EditorPane
            key={selectedPage.id}
            db={db}
            page={selectedPage}
            onRename={handleRename}
            onDocumentSaved={handleDocumentSaved}
          />
        ) : (
          <div className="empty-state">
            <p>No page selected.</p>
            <button onClick={() => void handleCreate(null)}>Create your first page</button>
          </div>
        )}
      </main>
      <SearchDialog
        db={db}
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onOpenPage={setSelectedId}
      />
    </div>
  )
}
