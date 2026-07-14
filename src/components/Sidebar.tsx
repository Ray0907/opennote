import React from 'react'
import type { Page } from '../db/repo'

interface SidebarProps {
  pages: Page[]
  selectedId: string | null
  onSelect: (id: string) => void
  onCreate: (parentId: string | null) => void
  onDelete: (id: string) => void
}

interface TreeNodeProps extends Omit<SidebarProps, 'pages'> {
  page: Page
  childrenOf: Map<string | null, Page[]>
  depth: number
}

function TreeNode({ page, childrenOf, depth, selectedId, onSelect, onCreate, onDelete }: TreeNodeProps) {
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
        />
      ))}
    </div>
  )
}

export function Sidebar({ pages, selectedId, onSelect, onCreate, onDelete }: SidebarProps) {
  const childrenOf = new Map<string | null, Page[]>()
  for (const page of pages) {
    const key = page.parent_id
    if (!childrenOf.has(key)) childrenOf.set(key, [])
    childrenOf.get(key)!.push(page)
  }
  const roots = childrenOf.get(null) ?? []

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span className="wordmark">OpenNote</span>
        <button title="New page" onClick={() => onCreate(null)}>
          + New
        </button>
      </div>
      <nav className="tree">
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
          />
        ))}
        {roots.length === 0 && <div className="tree-empty">No pages yet</div>}
      </nav>
    </aside>
  )
}
