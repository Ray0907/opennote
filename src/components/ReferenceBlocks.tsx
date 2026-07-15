import React, { createContext, useContext } from 'react'
import type { PGlite } from '@electric-sql/pglite'
import { BlockNoteSchema, defaultBlockSpecs } from '@blocknote/core'
import { createReactBlockSpec, useEditorChange } from '@blocknote/react'
import type { Page } from '../db/repo'
import { DatabaseView } from './DatabaseView'

interface ReferenceContextValue {
  db: PGlite
  pages: Page[]
  onChanged: () => Promise<unknown>
  onOpenPage: (id: string) => void
  onDeleteRow: (id: string) => Promise<void>
  /** Page the editor is currently showing, for the breadcrumb block. */
  currentPageId?: string
}

export const ReferenceBlockContext = createContext<ReferenceContextValue | null>(null)

const PageLinkBlock = createReactBlockSpec(
  {
    type: 'pageLink',
    propSchema: {
      pageId: { default: '' },
      title: { default: 'Untitled' },
    },
    content: 'none',
  },
  {
    render: ({ block }) => {
      const context = useContext(ReferenceBlockContext)
      const page = context?.pages.find((candidate) => candidate.id === block.props.pageId)
      return (
        <button
          className="reference-page"
          contentEditable={false}
          disabled={!page}
          onClick={() => page && context?.onOpenPage(page.id)}
        >
          <span>{page?.icon || '📄'}</span>
          <span>{page?.title || block.props.title || 'Missing page'}</span>
          <span aria-hidden="true">↗</span>
        </button>
      )
    },
    toExternalHTML: ({ block }) => (
      <a href={`opennote://page/${block.props.pageId}`}>{block.props.title}</a>
    ),
  },
)

const LinkedDatabaseBlock = createReactBlockSpec(
  {
    type: 'databaseView',
    propSchema: {
      databaseId: { default: '' },
      title: { default: 'Database' },
    },
    content: 'none',
  },
  {
    render: ({ block }) => {
      const context = useContext(ReferenceBlockContext)
      const database = context?.pages.find(
        (candidate) => candidate.id === block.props.databaseId && candidate.is_database,
      )
      if (!context || !database) {
        return <p className="reference-missing" contentEditable={false}>Linked database unavailable.</p>
      }
      return (
        <section className="reference-database" contentEditable={false}>
          <div className="reference-database-title">{database.icon || '▦'} {database.title || block.props.title}</div>
          <DatabaseView
            db={context.db}
            page={database}
            pages={context.pages}
            onChanged={context.onChanged}
            onOpenRow={context.onOpenPage}
            onDeleteRow={context.onDeleteRow}
          />
        </section>
      )
    },
    toExternalHTML: ({ block }) => (
      <a href={`opennote://database/${block.props.databaseId}`}>{block.props.title}</a>
    ),
  },
)

const CalloutBlock = createReactBlockSpec(
  {
    type: 'callout',
    propSchema: { icon: { default: '💡' } },
    content: 'inline',
  },
  {
    render: ({ block, contentRef }) => (
      <aside className="callout-block">
        <span contentEditable={false}>{block.props.icon}</span>
        <p ref={contentRef} />
      </aside>
    ),
    toExternalHTML: ({ block, contentRef }) => (
      <blockquote><span>{block.props.icon} </span><span ref={contentRef} /></blockquote>
    ),
  },
)

const ToggleBlock = createReactBlockSpec(
  {
    type: 'toggle',
    propSchema: { collapsed: { default: false } },
    content: 'inline',
  },
  {
    render: ({ block, editor, contentRef }) => (
      <div className="toggle-block" data-collapsed={block.props.collapsed}>
        <button
          contentEditable={false}
          aria-label={block.props.collapsed ? 'Expand toggle' : 'Collapse toggle'}
          onClick={() => editor.updateBlock(block, { props: { collapsed: !block.props.collapsed } })}
        >
          {block.props.collapsed ? '▸' : '▾'}
        </button>
        <p ref={contentRef} />
      </div>
    ),
    toExternalHTML: ({ contentRef }) => <details open><summary ref={contentRef} /></details>,
  },
)

const BreadcrumbBlock = createReactBlockSpec(
  { type: 'breadcrumb', propSchema: {}, content: 'none' },
  {
    render: () => {
      const context = useContext(ReferenceBlockContext)
      const trail: Page[] = []
      if (context?.currentPageId) {
        const byId = new Map(context.pages.map((p) => [p.id, p]))
        const seen = new Set<string>()
        let cur = byId.get(context.currentPageId)
        while (cur && !seen.has(cur.id)) {
          seen.add(cur.id)
          trail.unshift(cur)
          cur = cur.parent_id ? byId.get(cur.parent_id) : undefined
        }
      }
      return (
        <nav className="breadcrumb-block" contentEditable={false} aria-label="Breadcrumb">
          {trail.length === 0 ? (
            <span className="breadcrumb-empty">/</span>
          ) : (
            trail.map((p, i) => (
              <React.Fragment key={p.id}>
                {i > 0 && <span className="breadcrumb-sep" aria-hidden="true">/</span>}
                <button className="breadcrumb-item" onClick={() => context?.onOpenPage(p.id)}>
                  {p.icon ? `${p.icon} ` : ''}{p.title || 'Untitled'}
                </button>
              </React.Fragment>
            ))
          )}
        </nav>
      )
    },
    toExternalHTML: () => <nav aria-label="Breadcrumb">Breadcrumb</nav>,
  },
)

const TableOfContentsBlock = createReactBlockSpec(
  { type: 'tableOfContents', propSchema: {}, content: 'none' },
  {
    render: ({ editor }) => {
      // Re-read on every edit so the outline tracks heading changes live.
      const [, bump] = React.useReducer((x: number) => x + 1, 0)
      useEditorChange(() => bump(), editor)
      type DocBlock = { id: string; type: string; content?: Array<{ text?: string }>; props?: { level?: number } }
      const headings = (editor.document as unknown as DocBlock[]).filter((b) => b.type === 'heading')
      return (
        <nav className="toc-block" contentEditable={false} aria-label="Table of contents">
          {headings.length === 0 ? (
            <span className="toc-empty">No headings yet</span>
          ) : (
            headings.map((h) => {
              const label = h.content?.map((n) => n.text ?? '').join('').trim() || 'Untitled'
              return (
                <button
                  key={h.id}
                  className="toc-item"
                  data-level={Number(h.props?.level) || 1}
                  onClick={() => {
                    editor.setTextCursorPosition(h.id, 'start')
                    editor.focus()
                  }}
                >
                  {label}
                </button>
              )
            })
          )}
        </nav>
      )
    },
    toExternalHTML: () => <nav aria-label="Table of contents">Table of contents</nav>,
  },
)

const ColumnsBlock = createReactBlockSpec(
  {
    type: 'columns',
    propSchema: { columns: { default: 2 } },
    content: 'none',
  },
  { render: () => <div className="columns-block" contentEditable={false}>Columns</div> },
)

const ColumnBlock = createReactBlockSpec(
  { type: 'column', propSchema: {}, content: 'none' },
  { render: () => <div className="column-block" contentEditable={false} /> },
)

export const openNoteSchema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    pageLink: PageLinkBlock,
    databaseView: LinkedDatabaseBlock,
    callout: CalloutBlock,
    toggle: ToggleBlock,
    columns: ColumnsBlock,
    column: ColumnBlock,
    tableOfContents: TableOfContentsBlock,
    breadcrumb: BreadcrumbBlock,
  },
})
