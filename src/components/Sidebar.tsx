import React, { useState } from 'react'
import type { Page } from '../db/repo'
import { TEMPLATES } from '../lib/templates'
import { SyncStatusBar } from './SyncStatusBar'

interface SidebarProps {
  pages: Page[]
  selectedId: string | null
  onSelect: (id: string) => void
  onCreate: (parentId: string | null) => void
  onCreateDatabase: () => void
  onCreateFromTemplate: (templateId: string) => void
  onDelete: (id: string) => void
  onImport: () => void
  /** Export the selected page; null disables the button (nothing exportable). */
  onExport: (() => void) | null
  onToggleFavorite: (id: string, fav: boolean) => void
  /** Current theme preference ('system' | 'light' | 'dark') and its cycler. */
  themePref: 'system' | 'light' | 'dark'
  onCycleTheme: () => void
  onOpenTrash: () => void
  onDuplicate: (id: string) => void
  onMove: (id: string, parentId: string | null) => void
  onReorder: (id: string, beforeId: string) => void
}

interface TreeNodeProps
  extends Omit<
    SidebarProps,
    | 'pages'
    | 'onCreateDatabase'
    | 'onCreateFromTemplate'
    | 'onImport'
    | 'onExport'
    | 'themePref'
    | 'onCycleTheme'
    | 'onOpenTrash'
    | 'onDuplicate'
    | 'onMove'
    | 'onReorder'
  > {
  page: Page
  childrenOf: Map<string | null, Page[]>
  depth: number
  onRequestMove: (id: string) => void
  onDuplicate: (id: string) => void
  onReorder: (id: string, beforeId: string) => void
}

function TreeNode({ page, childrenOf, depth, selectedId, onSelect, onCreate, onDelete, onToggleFavorite, onRequestMove, onDuplicate, onReorder }: TreeNodeProps) {
  const children = childrenOf.get(page.id) ?? []
  return (
    <div>
      <div
        className={`tree-item${page.id === selectedId ? ' selected' : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        role="button"
        tabIndex={0}
        aria-current={page.id === selectedId ? 'page' : undefined}
        draggable
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData('application/x-opennote-page', page.id)
        }}
        onDragOver={(event) => {
          event.preventDefault()
          event.dataTransfer.dropEffect = 'move'
        }}
        onDrop={(event) => {
          event.preventDefault()
          event.stopPropagation()
          const draggedId = event.dataTransfer.getData('application/x-opennote-page')
          if (draggedId && draggedId !== page.id) onReorder(draggedId, page.id)
        }}
        onClick={() => onSelect(page.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onSelect(page.id)
          }
        }}
      >
        <span className="tree-title">
          {page.icon ? `${page.icon} ` : ''}
          {page.title || 'Untitled'}
        </span>
        <span className="tree-actions">
          <button
            aria-label="Duplicate page"
            title="Duplicate page"
            onClick={(e) => {
              e.stopPropagation()
              onDuplicate(page.id)
            }}
          >
            ⧉
          </button>
          <button
            aria-label="Move page"
            title="Move page"
            onClick={(e) => {
              e.stopPropagation()
              onRequestMove(page.id)
            }}
          >
            ↪
          </button>
          <button
            aria-label={page.is_favorite ? 'Remove from favorites' : 'Add to favorites'}
            title={page.is_favorite ? 'Remove from favorites' : 'Add to favorites'}
            onClick={(e) => {
              e.stopPropagation()
              onToggleFavorite(page.id, !page.is_favorite)
            }}
          >
            {page.is_favorite ? '★' : '☆'}
          </button>
          <button
            aria-label="Add sub-page"
            title="Add sub-page"
            onClick={(e) => {
              e.stopPropagation()
              onCreate(page.id)
            }}
          >
            +
          </button>
          <button
            aria-label="Delete page"
            title="Delete page"
            onClick={(e) => {
              e.stopPropagation()
              onDelete(page.id)
            }}
          >
            ×
          </button>
        </span>
      </div>
      {children.map((child) => (
        <TreeNode
          key={child.id}
          page={child}
          childrenOf={childrenOf}
          depth={depth + 1}
          selectedId={selectedId}
          onSelect={onSelect}
          onCreate={onCreate}
          onDelete={onDelete}
          onToggleFavorite={onToggleFavorite}
          onRequestMove={onRequestMove}
          onDuplicate={onDuplicate}
          onReorder={onReorder}
        />
      ))}
    </div>
  )
}

export function Sidebar({
  pages,
  selectedId,
  onSelect,
  onCreate,
  onCreateDatabase,
  onCreateFromTemplate,
  onDelete,
  onImport,
  onExport,
  onToggleFavorite,
  themePref,
  onCycleTheme,
  onOpenTrash,
  onDuplicate,
  onMove,
  onReorder,
}: SidebarProps) {
  const [showTemplates, setShowTemplates] = useState(false)
  const [movingId, setMovingId] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const childrenOf = new Map<string | null, Page[]>()
  for (const page of pages) {
    const key = page.parent_id
    if (!childrenOf.has(key)) childrenOf.set(key, [])
    childrenOf.get(key)!.push(page)
  }
  const roots = childrenOf.get(null) ?? []
  const favorites = pages.filter((p) => p.is_favorite)
  const moving = pages.find((page) => page.id === movingId)
  const unavailableTargets = new Set<string>(movingId ? [movingId] : [])
  if (movingId) {
    let changed = true
    while (changed) {
      changed = false
      for (const page of pages) {
        if (page.parent_id && unavailableTargets.has(page.parent_id) && !unavailableTargets.has(page.id)) {
          unavailableTargets.add(page.id)
          changed = true
        }
      }
    }
  }
  const navigateTree = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('.tree-item[role="button"]'))
    const current = (event.target as HTMLElement).closest<HTMLElement>('.tree-item[role="button"]')
    const index = current ? items.indexOf(current) : -1
    const next = event.key === 'ArrowDown' ? items[index + 1] : items[index - 1]
    if (next) {
      event.preventDefault()
      next.focus()
    }
  }

  return (
    <aside className={`sidebar${collapsed ? ' collapsed' : ''}`}>
      <div className="sidebar-header">
        <span className="wordmark">{collapsed ? 'O' : 'OpenNote'}</span>
        <div className="sidebar-header-actions">
          <button title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={() => setCollapsed((value) => !value)}>
            {collapsed ? '›' : '‹'}
          </button>
          <button
            className="theme-toggle"
            title={`Theme: ${themePref} (click to change)`}
            aria-label={`Theme: ${themePref}. Click to change.`}
            onClick={onCycleTheme}
          >
            {themePref === 'system' ? '◐' : themePref === 'light' ? '☀' : '☾'}
          </button>
          <button title="New page" onClick={() => onCreate(null)}>
            + New
          </button>
          <button title="New database" onClick={() => onCreateDatabase()}>
            + DB
          </button>
        </div>
      </div>
      {favorites.length > 0 && (
        <nav className="tree tree-favorites" onKeyDown={navigateTree}>
          <div className="tree-section-label">Favorites</div>
          {favorites.map((page) => (
            <div
              key={page.id}
              className={`tree-item${page.id === selectedId ? ' selected' : ''}`}
              style={{ paddingLeft: 8 }}
              role="button"
              tabIndex={0}
              aria-current={page.id === selectedId ? 'page' : undefined}
              onClick={() => onSelect(page.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onSelect(page.id)
                }
              }}
            >
              <span className="tree-title">
                {page.icon ? `${page.icon} ` : ''}
                {page.title || 'Untitled'}
              </span>
              <span className="tree-actions">
                <button
                  aria-label="Remove from favorites"
                  title="Remove from favorites"
                  onClick={(e) => {
                    e.stopPropagation()
                    onToggleFavorite(page.id, false)
                  }}
                >
                  ★
                </button>
              </span>
            </div>
          ))}
        </nav>
      )}
      <nav className="tree" onKeyDown={navigateTree}>
        <div className="tree-section-label">Pages</div>
        {roots.map((page) => (
          <TreeNode
            key={page.id}
            page={page}
            childrenOf={childrenOf}
            depth={0}
            selectedId={selectedId}
            onSelect={onSelect}
            onCreate={onCreate}
            onDelete={onDelete}
            onToggleFavorite={onToggleFavorite}
            onRequestMove={setMovingId}
            onDuplicate={onDuplicate}
            onReorder={onReorder}
          />
        ))}
        {roots.length === 0 && <div className="tree-empty">No pages yet</div>}
      </nav>
      {moving && (
        <div className="move-picker" role="dialog" aria-label="Move page">
          <strong>Move “{moving.title || 'Untitled'}”</strong>
          <select
            aria-label="New parent"
            defaultValue=""
            onChange={(event) => {
              if (!event.target.value) return
              onMove(moving.id, event.target.value === '__root' ? null : event.target.value)
              setMovingId(null)
            }}
          >
            <option value="">Choose destination…</option>
            <option value="__root">Top level</option>
            {pages.filter((page) => !unavailableTargets.has(page.id) && !page.is_database).map((page) => (
              <option key={page.id} value={page.id}>{page.title || 'Untitled'}</option>
            ))}
          </select>
          <button onClick={() => setMovingId(null)}>Cancel</button>
        </div>
      )}
      {showTemplates && (
        <div className="template-menu">
          {TEMPLATES.map((t) => (
            <button
              key={t.id}
              className="template-item"
              onClick={() => {
                setShowTemplates(false)
                onCreateFromTemplate(t.id)
              }}
            >
              {t.icon ? `${t.icon} ` : ''}
              {t.title}
            </button>
          ))}
        </div>
      )}
      <SyncStatusBar />
      <div className="sidebar-footer">
        <button title="Create page from template" onClick={() => setShowTemplates((v) => !v)}>
          Templates
        </button>
        <button title="Import Markdown files" onClick={() => onImport()}>
          Import
        </button>
        <button
          title={onExport ? 'Export current page as Markdown' : 'Select a page to export'}
          disabled={!onExport}
          onClick={() => onExport?.()}
        >
          Export
        </button>
        <button title="View deleted pages" onClick={() => onOpenTrash()}>
          Trash
        </button>
      </div>
    </aside>
  )
}
