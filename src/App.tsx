import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PGlite } from '@electric-sql/pglite'
import type { Page } from './db/repo'
import * as repo from './db/repo'
import { getShell } from './shell'
import {
  attachmentPrefixForMirror,
  markdownToPage,
  pageToMarkdown,
  sanitizeFileName,
  type BNBlock,
} from './lib/markdown'
import { Sidebar } from './components/Sidebar'
import { SearchDialog } from './components/SearchDialog'
import { EditorPane, flushOpenEditor } from './components/EditorPane'
import { DatabaseView } from './components/DatabaseView'
import { TrashDialog } from './components/TrashDialog'
import { Toast, type ToastState } from './components/Toast'
import { createDefaultSchema } from './lib/database'
import { getTemplate } from './lib/templates'
import { useTheme } from './lib/theme'
import { HistoryDialog } from './components/HistoryDialog'

/** Vault-relative mirror path: nested folders following the page tree. */
export function legacyMirrorPathFor(pages: Page[], pageId: string): string {
  const byId = new Map(pages.map((p) => [p.id, p]))
  const segments: string[] = []
  let current = byId.get(pageId)
  while (current) {
    segments.unshift(sanitizeFileName(current.title))
    current = current.parent_id ? byId.get(current.parent_id) : undefined
  }
  return segments.join('/') + '.md'
}

export function mirrorPathFor(pages: Page[], pageId: string): string {
  const legacy = legacyMirrorPathFor(pages, pageId)
  const extension = legacy.endsWith('.md') ? '.md' : ''
  return `${legacy.slice(0, -extension.length)}--${pageId}${extension}`
}

export function legacyMirrorPathsToDelete(pages: Page[]): string[] {
  const mirrored = pages.filter((page) => !page.is_database)
  const nextPaths = new Set(mirrored.map((page) => mirrorPathFor(pages, page.id)))
  return [...new Set(
    mirrored
      .map((page) => legacyMirrorPathFor(pages, page.id))
      .filter((legacyPath) => !nextPaths.has(legacyPath)),
  )]
}

export function pageSubtree(pages: Page[], pageId: string): Page[] {
  const ids = new Set([pageId])
  let changed = true
  while (changed) {
    changed = false
    for (const page of pages) {
      if (page.parent_id && ids.has(page.parent_id) && !ids.has(page.id)) {
        ids.add(page.id)
        changed = true
      }
    }
  }
  return pages.filter((page) => ids.has(page.id))
}

export function App({ db }: { db: PGlite }) {
  const [pages, setPages] = useState<Page[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [trashOpen, setTrashOpen] = useState(false)
  const [toast, setToast] = useState<ToastState | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [editorEpoch, setEditorEpoch] = useState(0)
  const { pref, resolved, cycleTheme } = useTheme()
  // Last mirror path per page, so renames/moves clean up their old file.
  const mirrorPaths = useRef(new Map<string, string>())
  const shell = useMemo(() => getShell(), [])

  const refreshPages = useCallback(async () => {
    const next = await repo.listPages(db)
    setPages(next)
    return next
  }, [db])

  useEffect(() => {
    void refreshPages().then(async (loaded) => {
      try {
        if (shell.isDesktop && window.localStorage.getItem('opennote.mirror_path_version') !== '2') {
          for (const page of loaded.filter((candidate) => !candidate.is_database)) {
            const blocks = (await repo.getBlocks(db, page.id)).map((row) => row.content)
            const nextPath = mirrorPathFor(loaded, page.id)
            await shell.writeMirror(
              nextPath,
              pageToMarkdown(page, blocks, attachmentPrefixForMirror(nextPath)),
            )
            mirrorPaths.current.set(page.id, nextPath)
          }
          for (const legacyPath of legacyMirrorPathsToDelete(loaded)) {
            await shell.deleteMirror(legacyPath)
          }
          window.localStorage.setItem('opennote.mirror_path_version', '2')
        }
      } catch (error) {
        console.error('Mirror path migration failed', error)
      } finally {
        if (loaded.length > 0) setSelectedId((cur) => cur ?? loaded[0].id)
      }
    })
  }, [db, refreshPages, shell])

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
    async (allPages: Page[], pageId: string, blocks: BNBlock[], previousPath?: string) => {
      const page = allPages.find((p) => p.id === pageId)
      if (!page) return
      const relPath = mirrorPathFor(allPages, pageId)
      const previous = previousPath ?? mirrorPaths.current.get(pageId)
      await shell.writeMirror(
        relPath,
        pageToMarkdown(page, blocks, attachmentPrefixForMirror(relPath)),
      )
      if (previous && previous !== relPath) await shell.deleteMirror(previous)
      mirrorPaths.current.set(pageId, relPath)
    },
    [shell],
  )

  const handleCreate = useCallback(
    async (parentId: string | null) => {
      const page = await repo.createPage(db, { parentId, title: 'Untitled' })
      const next = await refreshPages()
      setSelectedId(page.id)
      await mirrorPage(next, page.id, [])
      return page
    },
    [db, refreshPages, mirrorPage],
  )

  const handleCreateLinkedSubPage = useCallback(
    async (parentId: string) => {
      const page = await repo.createPage(db, { parentId, title: 'Untitled' })
      const next = await refreshPages()
      await mirrorPage(next, page.id, [])
      return page
    },
    [db, refreshPages, mirrorPage],
  )

  const handleCreateFromTemplate = useCallback(
    async (templateId: string) => {
      const template = getTemplate(templateId)
      if (!template) return
      const page = await repo.createPage(db, { parentId: null, title: template.title })
      if (template.icon) await repo.setPageIcon(db, page.id, template.icon)
      const blocks = template.build()
      await repo.savePageBlocks(db, page.id, blocks)
      const next = await refreshPages()
      setSelectedId(page.id)
      await mirrorPage(next, page.id, blocks)
    },
    [db, refreshPages, mirrorPage],
  )

  const handleCreateDatabase = useCallback(async () => {
    const page = await repo.createPage(db, { parentId: null, title: 'New database', isDatabase: true })
    await repo.setDbSchema(db, page.id, createDefaultSchema())
    await refreshPages()
    setSelectedId(page.id)
  }, [db, refreshPages])

  const handleDuplicate = useCallback(async (id: string) => {
    await flushOpenEditor()
    const copy = await repo.duplicatePage(db, id)
    const next = await refreshPages()
    setSelectedId(copy.id)
    for (const duplicated of pageSubtree(next, copy.id)) {
      if (duplicated.is_database) continue
      const blocks = (await repo.getBlocks(db, duplicated.id)).map((row) => row.content)
      await mirrorPage(next, duplicated.id, blocks)
    }
  }, [db, refreshPages, mirrorPage])

  const handleMove = useCallback(async (id: string, parentId: string | null) => {
    await flushOpenEditor()
    const oldPaths = new Map(
      pageSubtree(pages, id)
        .filter((page) => !page.is_database)
        .map((page) => [page.id, mirrorPaths.current.get(page.id) ?? mirrorPathFor(pages, page.id)]),
    )
    await repo.movePage(db, id, parentId)
    const next = await refreshPages()
    for (const moved of pageSubtree(next, id)) {
      if (moved.is_database) continue
      const blocks = (await repo.getBlocks(db, moved.id)).map((row) => row.content)
      await mirrorPage(next, moved.id, blocks, oldPaths.get(moved.id))
    }
  }, [db, pages, refreshPages, mirrorPage])

  const handleReorder = useCallback(async (id: string, beforeId: string) => {
    await flushOpenEditor()
    const oldPaths = new Map(
      pageSubtree(pages, id)
        .filter((page) => !page.is_database)
        .map((page) => [page.id, mirrorPaths.current.get(page.id) ?? mirrorPathFor(pages, page.id)]),
    )
    await repo.reorderPage(db, id, beforeId)
    const next = await refreshPages()
    for (const moved of pageSubtree(next, id)) {
      if (moved.is_database) continue
      const blocks = (await repo.getBlocks(db, moved.id)).map((row) => row.content)
      await mirrorPage(next, moved.id, blocks, oldPaths.get(moved.id))
    }
  }, [db, pages, refreshPages, mirrorPage])

  const handleRename = useCallback(
    async (id: string, title: string) => {
      await flushOpenEditor()
      const oldPaths = new Map(
        pageSubtree(pages, id)
          .filter((page) => !page.is_database)
          .map((page) => [page.id, mirrorPaths.current.get(page.id) ?? mirrorPathFor(pages, page.id)]),
      )
      await repo.renamePage(db, id, title)
      const next = await refreshPages()
      for (const renamed of pageSubtree(next, id)) {
        if (renamed.is_database) continue
        const blocks = (await repo.getBlocks(db, renamed.id)).map((row) => row.content)
        await mirrorPage(next, renamed.id, blocks, oldPaths.get(renamed.id))
      }
    },
    [db, pages, refreshPages, mirrorPage],
  )

  const restorePage = useCallback(
    async (id: string) => {
      await flushOpenEditor()
      await repo.restorePage(db, id)
      const next = await refreshPages()
      setSelectedId(id)
      for (const restored of pageSubtree(next, id)) {
        if (restored.is_database) continue
        const blocks = (await repo.getBlocks(db, restored.id)).map((row) => row.content)
        await mirrorPage(next, restored.id, blocks)
      }
    },
    [db, refreshPages, mirrorPage],
  )

  const handleDelete = useCallback(
    async (id: string) => {
      await flushOpenEditor()
      const title = pages.find((p) => p.id === id)?.title || 'Untitled'
      const mirrorPathsToDelete = pageSubtree(pages, id)
        .filter((page) => !page.is_database)
        .map((page) => ({
          id: page.id,
          path: mirrorPaths.current.get(page.id) ?? mirrorPathFor(pages, page.id),
        }))
      await repo.deletePage(db, id)
      for (const mirror of mirrorPathsToDelete) {
        await shell.deleteMirror(mirror.path)
        mirrorPaths.current.delete(mirror.id)
      }
      const next = await refreshPages()
      setSelectedId((cur) => (cur === id ? (next[0]?.id ?? null) : cur))
      setToast({
        message: `Deleted "${title}"`,
        actionLabel: 'Undo',
        onAction: () => void restorePage(id),
      })
    },
    [db, pages, refreshPages, shell, restorePage],
  )

  const handleDocumentSaved = useCallback(
    async (pageId: string, blocks: BNBlock[]) => {
      await repo.savePageBlocks(db, pageId, blocks)
      await mirrorPage(await repo.listPages(db), pageId, blocks)
    },
    [db, mirrorPage],
  )

  const selectedPage = pages.find((p) => p.id === selectedId) ?? null

  const handleRestoreRevision = useCallback(async (content: string) => {
    if (!selectedPage || selectedPage.is_database) return
    await flushOpenEditor()
    const oldPaths = new Map(
      pageSubtree(pages, selectedPage.id)
        .filter((page) => !page.is_database)
        .map((page) => [page.id, mirrorPaths.current.get(page.id) ?? mirrorPathFor(pages, page.id)]),
    )
    const restored = markdownToPage(content, selectedPage.title)
    await repo.renamePage(db, selectedPage.id, restored.title)
    await repo.savePageBlocks(db, selectedPage.id, restored.blocks)
    const next = await refreshPages()
    for (const page of pageSubtree(next, selectedPage.id)) {
      if (page.is_database) continue
      const blocks = page.id === selectedPage.id
        ? restored.blocks
        : (await repo.getBlocks(db, page.id)).map((row) => row.content)
      await mirrorPage(next, page.id, blocks, oldPaths.get(page.id))
    }
    setEditorEpoch((value) => value + 1)
  }, [db, pages, selectedPage, refreshPages, mirrorPage])

  /** M4 export: current (non-database) page → .md via the shell save dialog. */
  const handleExport = useCallback(async () => {
    if (!selectedPage || selectedPage.is_database) return
    await flushOpenEditor()
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
    const imported: Array<{ id: string; blocks: BNBlock[] }> = []
    for (const file of files) {
      const fallback = file.name.replace(/\.(md|markdown|txt)$/i, '') || 'Imported page'
      const { title, blocks } = markdownToPage(file.content, fallback)
      const page = await repo.createPage(db, { parentId: null, title })
      await repo.savePageBlocks(db, page.id, blocks)
      imported.push({ id: page.id, blocks })
    }
    const next = await refreshPages()
    for (const page of imported) await mirrorPage(next, page.id, page.blocks)
    const last = imported.at(-1)
    if (last) {
      setSelectedId(last.id)
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
        onCreateFromTemplate={(id) => void handleCreateFromTemplate(id)}
        onDelete={handleDelete}
        onImport={() => void handleImport()}
        onExport={
          selectedPage && !selectedPage.is_database ? () => void handleExport() : null
        }
        onToggleFavorite={(id, fav) => {
          void repo.setFavorite(db, id, fav).then(refreshPages)
        }}
        themePref={pref}
        onCycleTheme={cycleTheme}
        onOpenTrash={() => setTrashOpen(true)}
        onDuplicate={(id) => void handleDuplicate(id)}
        onMove={(id, parentId) => void handleMove(id, parentId)}
        onReorder={(id, beforeId) => void handleReorder(id, beforeId)}
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
              onDeleteRow={handleDelete}
            />
          </div>
        ) : selectedPage ? (
          <EditorPane
            key={`${selectedPage.id}:${editorEpoch}`}
            db={db}
            page={selectedPage}
            theme={resolved}
            onRename={handleRename}
            onDocumentSaved={handleDocumentSaved}
            onSetIcon={(id, icon) => {
              void repo.setPageIcon(db, id, icon).then(refreshPages)
            }}
            onSetCover={(id, cover) => {
              void repo.setPageCover(db, id, cover).then(refreshPages)
            }}
            pages={pages}
            onOpenPage={setSelectedId}
            onCreateSubPage={handleCreateLinkedSubPage}
            onChanged={refreshPages}
            onDeleteRow={handleDelete}
            onOpenHistory={() => {
              void flushOpenEditor().then(() => setHistoryOpen(true))
            }}
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
      <TrashDialog
        db={db}
        open={trashOpen}
        onClose={() => setTrashOpen(false)}
        onRestored={(id) => {
          setTrashOpen(false)
          void refreshPages().then(async (next) => {
            setSelectedId(id)
            for (const restored of pageSubtree(next, id)) {
              if (restored.is_database) continue
              const blocks = (await repo.getBlocks(db, restored.id)).map((row) => row.content)
              await mirrorPage(next, restored.id, blocks)
            }
          })
        }}
      />
      <Toast toast={toast} onDismiss={() => setToast(null)} />
      <HistoryDialog
        open={historyOpen}
        relPath={selectedPage && !selectedPage.is_database ? mirrorPathFor(pages, selectedPage.id) : null}
        pageTitle={selectedPage?.title ?? ''}
        onClose={() => setHistoryOpen(false)}
        onRestore={handleRestoreRevision}
      />
    </div>
  )
}
