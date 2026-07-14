import React, { useState } from 'react'
import type { Page } from '../db/repo'
import { TEMPLATES } from '../lib/templates'

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
  > {
  page: Page
  childrenOf: Map<string | null, Page[]>
  depth: number
}

function TreeNode({ page, childrenOf, depth, selectedId, onSelect, onCreate, onDelete, onToggleFavorite }: TreeNodeProps) {
  const children = childrenOf.get(page.id) ?? []
  return (
    <div>
      <div
        className={`tree-item${page.id === selectedId ? ' selected' : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => onSelect(page.id)}
      >
        <span className="tree-title">
          {page.icon ? `${page.icon} ` : ''}
          {page.title || 'Untitled'}
        </span>
        <span className="tree-actions">
          <button
            title={page.is_favorite ? 'Remove from favorites' : 'Add to favorites'}
            onClick={(e) => {
              e.stopPropagation()
              onToggleFavorite(page.id, !page.is_favorite)
            }}
          >
            {page.is_favorite ? '★' : '☆'}
          </button>
          <button
            title="Add sub-page"
            onClick={(e) => {
              e.stopPropagation()
              onCreate(page.id)
            }}
          >
            +
          </button>
          <button
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
}: SidebarProps) {
  const [showTemplates, setShowTemplates] = useState(false)
  const childrenOf = new Map<string | null, Page[]>()
  for (const page of pages) {
    const key = page.parent_id
    if (!childrenOf.has(key)) childrenOf.set(key, [])
    childrenOf.get(key)!.push(page)
  }
  const roots = childrenOf.get(null) ?? []
  const favorites = pages.filter((p) => p.is_favorite)

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span className="wordmark">OpenNote</span>
        <div className="sidebar-header-actions">
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
        <nav className="tree tree-favorites">
          <div className="tree-section-label">Favorites</div>
          {favorites.map((page) => (
            <div
              key={page.id}
              className={`tree-item${page.id === selectedId ? ' selected' : ''}`}
              style={{ paddingLeft: 8 }}
              onClick={() => onSelect(page.id)}
            >
              <span className="tree-title">
                {page.icon ? `${page.icon} ` : ''}
                {page.title || 'Untitled'}
              </span>
              <span className="tree-actions">
                <button
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
      <nav className="tree">
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
          />
        ))}
        {roots.length === 0 && <div className="tree-empty">No pages yet</div>}
      </nav>
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
      </div>
    </aside>
  )
}
