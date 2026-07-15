import React, { useMemo, useState } from 'react'
import type { PGlite } from '@electric-sql/pglite'
import type { Page } from '../db/repo'
import * as repo from '../db/repo'
import {
  applyView,
  coerceValue,
  computeRollup,
  createDefaultSchema,
  evaluateFormula,
  formatValue,
  groupRows,
  localId,
  normalizeSchema,
  statusColor,
  visibleProperties,
  type DbSchema,
  type PropertyDef,
  type PropertyType,
  type ViewDef,
} from '../lib/database'
import { AddPropertyPopover } from './AddPropertyPopover'
import { assertAttachmentSize, attachmentDisplayUrl, getShell } from '../shell'

interface DatabaseViewProps {
  db: PGlite
  /** The database page itself (is_database = true). */
  page: Page
  /** All pages; rows are the direct children of `page`. */
  pages: Page[]
  onChanged: () => Promise<unknown>
  onOpenRow: (id: string) => void
  /** Deletes a row-page through the app's undo-toast path (critique P1). */
  onDeleteRow: (id: string) => Promise<void>
}

export function DatabaseView({ db, page, pages, onChanged, onOpenRow, onDeleteRow }: DatabaseViewProps) {
  const [addingProperty, setAddingProperty] = useState(false)
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const schema = useMemo(() => {
    // A database page created before its schema was written gets the default.
    const raw = page.db_schema
    return raw ? normalizeSchema(raw) : createDefaultSchema()
  }, [page.db_schema])

  const rows = useMemo(
    () => pages.filter((p) => p.parent_id === page.id),
    [pages, page.id],
  )

  const [activeViewId, setActiveViewId] = useState(schema.views[0]?.id ?? '')
  const view = schema.views.find((v) => v.id === activeViewId) ?? schema.views[0]

  const visibleRows = useMemo(() => applyView(rows, view, schema), [rows, view, schema])
  const shell = useMemo(() => getShell(), [])

  const saveSchema = async (next: DbSchema) => {
    await repo.setDbSchema(db, page.id, next)
    await onChanged()
  }

  const setCell = async (row: Page, prop: PropertyDef, raw: string | boolean) => {
    const props = { ...(row.props ?? {}) }
    props[prop.id] = coerceValue(prop.type, raw)
    await repo.setPageProps(db, row.id, props)
    await onChanged()
  }

  const uploadFiles = async (row: Page, prop: PropertyDef, files: File[]) => {
    try {
      setAttachmentError(null)
      assertAttachmentSize(files.reduce((total, file) => total + file.size, 0))
      const uploaded = await Promise.all(
        files.map(async (file) => {
          assertAttachmentSize(file.size)
          return shell.saveAttachment(file.name, file.type, await file.arrayBuffer())
        }),
      )
      const current = Array.isArray(row.props?.[prop.id]) ? row.props![prop.id] as string[] : []
      await repo.setPageProps(db, row.id, { ...(row.props ?? {}), [prop.id]: [...current, ...uploaded] })
      await onChanged()
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : String(error))
    }
  }

  const reorderRow = async (id: string, beforeId: string) => {
    await repo.reorderPage(db, id, beforeId)
    await onChanged()
  }

  const addRow = async () => {
    await repo.createPage(db, { parentId: page.id, title: '' })
    await onChanged()
  }

  const submitProperty = async (def: PropertyDef) => {
    setAddingProperty(false)
    await saveSchema({ ...schema, properties: [...schema.properties, def] })
  }

  const addView = async (kind: ViewDef['kind']) => {
    const v: ViewDef = { id: localId('view'), kind, name: kind[0].toUpperCase() + kind.slice(1) }
    if (kind === 'board') v.groupBy = schema.properties.find((p) => p.type === 'select' || p.type === 'status')?.id
    if (kind === 'calendar') v.groupBy = schema.properties.find((p) => p.type === 'date')?.id
    if (kind === 'timeline') v.groupBy = schema.properties.find((p) => p.type === 'date' || p.type === 'created-time')?.id
    await saveSchema({ ...schema, views: [...schema.views, v] })
    setActiveViewId(v.id)
  }

  const updateView = async (patch: Partial<ViewDef>) => {
    const next = { ...view, ...patch }
    await saveSchema({
      ...schema,
      views: schema.views.map((candidate) => (candidate.id === view.id ? next : candidate)),
    })
  }

  return (
    <div className="db-view">
      <div className="db-toolbar">
        {schema.views.map((v) => (
          <button
            key={v.id}
            className={v.id === view.id ? 'db-tab active' : 'db-tab'}
            onClick={() => setActiveViewId(v.id)}
          >
            {v.name}
          </button>
        ))}
        <span className="db-toolbar-spacer" />
        <ViewControls
          schema={schema}
          view={view}
          pages={pages}
          onChange={updateView}
        />
        <select
          className="db-add-view"
          aria-label="Add view"
          value=""
          onChange={(event) => {
            if (event.target.value) void addView(event.target.value as ViewDef['kind'])
          }}
        >
          <option value="">+ View</option>
          <option value="table">Table</option>
          <option value="board">Board</option>
          <option value="calendar">Calendar</option>
          <option value="list">List</option>
          <option value="gallery">Gallery</option>
          <option value="timeline">Timeline</option>
        </select>
      </div>
      {attachmentError && <p className="db-upload-error" role="alert">{attachmentError}</p>}
      {view.kind === 'table' && (
        <TableView
          schema={schema}
          rows={visibleRows}
          pages={pages}
          onOpenRow={onOpenRow}
          onSetCell={setCell}
          onRenameRow={async (id, title) => {
            await repo.renamePage(db, id, title)
            await onChanged()
          }}
          onDeleteRow={async (id) => {
            await onDeleteRow(id) // app path: soft-delete + undo toast + refresh
          }}
          onAddRow={addRow}
          onAddProperty={() => setAddingProperty(true)}
          view={view}
          onUploadFiles={uploadFiles}
        />
      )}
      {view.kind === 'board' && (
        <BoardView schema={schema} view={view} rows={visibleRows} onOpenRow={onOpenRow} onSetCell={setCell} onAddRow={addRow} onReorderRow={reorderRow} />
      )}
      {view.kind === 'calendar' && (
        <CalendarView schema={schema} view={view} rows={visibleRows} onOpenRow={onOpenRow} />
      )}
      {view.kind === 'list' && (
        <ListView schema={schema} rows={visibleRows} onOpenRow={onOpenRow} onAddRow={addRow} />
      )}
      {view.kind === 'gallery' && (
        <GalleryView rows={visibleRows} onOpenRow={onOpenRow} onAddRow={addRow} />
      )}
      {view.kind === 'timeline' && (
        <TimelineView schema={schema} view={view} rows={visibleRows} onOpenRow={onOpenRow} />
      )}
      {addingProperty && (
        <div className="prop-popover-anchor">
          <AddPropertyPopover
            currentPageId={page.id}
            pages={pages}
            existingRelations={schema.properties.filter((p) => p.type === 'relation')}
            onSubmit={(def) => void submitProperty(def)}
            onClose={() => setAddingProperty(false)}
          />
        </div>
      )}
    </div>
  )
}

function ViewControls({
  schema,
  view,
  pages,
  onChange,
}: {
  schema: DbSchema
  view: ViewDef
  pages: Page[]
  onChange: (patch: Partial<ViewDef>) => Promise<void>
}) {
  const filterProperty = view.filter?.property ?? ''
  const filterDef = schema.properties.find((property) => property.id === filterProperty)
  const filterable = schema.properties.filter((property) => property.type !== 'rollup')
  const sortable = filterable

  const setFilterValue = (raw: string) => {
    const type = filterProperty === 'title' ? 'text' : filterDef?.type
    const equals = type === 'multi-select' || type === 'relation' || type === 'files' ||
      type === 'formula' || type === 'created-time' || type === 'last-edited-time' ||
      type === 'created-by' || type === 'last-edited-by'
      ? (raw || null)
      : type
        ? coerceValue(type, raw)
        : raw
    void onChange({ filter: { property: filterProperty, equals } })
  }

  return (
    <div className="db-view-controls" aria-label="View options">
      <select
        aria-label="Filter property"
        value={filterProperty}
        onChange={(event) => {
          const property = event.target.value
          if (!property) void onChange({ filter: null })
          else {
            const def = schema.properties.find((candidate) => candidate.id === property)
            const equals = def?.type === 'checkbox' ? false : def?.options?.[0] ?? null
            void onChange({ filter: { property, equals } })
          }
        }}
      >
        <option value="">Filter</option>
        <option value="title">Title</option>
        {filterable.map((property) => (
          <option key={property.id} value={property.id}>
            {property.name}
          </option>
        ))}
      </select>
      {view.filter && (
        <FilterValueControl
          key={filterProperty}
          property={filterDef}
          value={view.filter.equals}
          pages={pages}
          onChange={setFilterValue}
        />
      )}
      <select
        aria-label="Sort property"
        value={view.sortBy ?? ''}
        onChange={(event) => {
          const sortBy = event.target.value || undefined
          void onChange({ sortBy, sortDir: sortBy ? (view.sortDir ?? 'asc') : undefined })
        }}
      >
        <option value="">Sort</option>
        <option value="title">Title</option>
        {sortable.map((property) => (
          <option key={property.id} value={property.id}>
            {property.name}
          </option>
        ))}
      </select>
      {view.sortBy && (
        <button
          className="db-sort-dir"
          title={view.sortDir === 'desc' ? 'Sort descending' : 'Sort ascending'}
          aria-label={view.sortDir === 'desc' ? 'Sort descending' : 'Sort ascending'}
          onClick={() => void onChange({ sortDir: view.sortDir === 'desc' ? 'asc' : 'desc' })}
        >
          {view.sortDir === 'desc' ? '↓' : '↑'}
        </button>
      )}
      {view.kind === 'table' && (
        <select
          aria-label="Group property"
          value={view.groupBy ?? ''}
          onChange={(event) => void onChange({ groupBy: event.target.value || undefined })}
        >
          <option value="">Group</option>
          {schema.properties.map((property) => (
            <option key={property.id} value={property.id}>{property.name}</option>
          ))}
        </select>
      )}
      {view.kind === 'table' && schema.properties.length > 0 && (
        <details className="db-props-menu">
          <summary title="Show / hide columns">Properties</summary>
          <div className="db-props-list">
            {schema.properties.map((property) => {
              const hidden = (view.hiddenProps ?? []).includes(property.id)
              return (
                <label key={property.id}>
                  <input
                    type="checkbox"
                    checked={!hidden}
                    onChange={() => {
                      const set = new Set(view.hiddenProps ?? [])
                      if (set.has(property.id)) set.delete(property.id)
                      else set.add(property.id)
                      void onChange({ hiddenProps: set.size > 0 ? [...set] : undefined })
                    }}
                  />
                  {property.name}
                </label>
              )
            })}
          </div>
        </details>
      )}
    </div>
  )
}

function FilterValueControl({
  property,
  value,
  pages,
  onChange,
}: {
  property?: PropertyDef
  value: unknown
  pages: Page[]
  onChange: (raw: string) => void
}) {
  if (property?.type === 'checkbox') {
    return (
      <select aria-label="Filter value" value={value === true ? 'true' : 'false'} onChange={(e) => onChange(e.target.value)}>
        <option value="true">Checked</option>
        <option value="false">Unchecked</option>
      </select>
    )
  }
  if (property?.type === 'select' || property?.type === 'multi-select' || property?.type === 'status') {
    return (
      <select aria-label="Filter value" value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)}>
        <option value="">Empty</option>
        {(property.options ?? []).map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    )
  }
  if (property?.type === 'relation') {
    const candidates = pages.filter((page) => page.parent_id === property.relationTarget)
    return (
      <select aria-label="Filter value" value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)}>
        <option value="">Empty</option>
        {candidates.map((page) => <option key={page.id} value={page.id}>{page.title || 'Untitled'}</option>)}
      </select>
    )
  }
  return (
    <input
      aria-label="Filter value"
      type={property?.type === 'number' ? 'number' : property?.type === 'date' ? 'date' : 'text'}
      defaultValue={formatValue(property?.type ?? 'text', value)}
      placeholder="Equals…"
      onBlur={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
      }}
    />
  )
}

/* ---------------- table ---------------- */

interface TableViewProps {
  schema: DbSchema
  rows: Page[]
  /** All pages, for relation/rollup lookups across databases. */
  pages: Page[]
  onOpenRow: (id: string) => void
  onSetCell: (row: Page, prop: PropertyDef, raw: string | boolean) => Promise<void>
  onRenameRow: (id: string, title: string) => Promise<void>
  onDeleteRow: (id: string) => Promise<void>
  onAddRow: () => Promise<void>
  onAddProperty: () => void
  view: ViewDef
  onUploadFiles: (row: Page, prop: PropertyDef, files: File[]) => Promise<void>
}

function TableView(p: TableViewProps) {
  const groups = p.view.groupBy
    ? groupRows(p.rows, p.view.groupBy, p.schema)
    : [{ label: '', rows: p.rows }]
  const cols = visibleProperties(p.schema, p.view)
  const span = cols.length + 2 // title + visible props + actions
  return (
    <table className="db-table">
      <thead>
        <tr>
          <th>Title</th>
          {cols.map((prop) => (
            <th key={prop.id}>{prop.name}</th>
          ))}
          <th>
            <button title="Add property" onClick={() => p.onAddProperty()}>
              +
            </button>
          </th>
        </tr>
      </thead>
      <tbody>
        {groups.map((group) => (
          <React.Fragment key={group.label || '__all'}>
            {p.view.groupBy && (
              <tr className="db-group-row">
                <th colSpan={span}>{group.label} <span>{group.rows.length}</span></th>
              </tr>
            )}
            {group.rows.map((row) => (
              <tr key={row.id}>
                <td>
                  <TitleCell row={row} onRename={p.onRenameRow} onOpen={p.onOpenRow} />
                </td>
                {cols.map((prop) => (
                  <td key={prop.id}>
                    <Cell prop={prop} row={row} pages={p.pages} schema={p.schema} onSetCell={p.onSetCell} onUploadFiles={p.onUploadFiles} />
                  </td>
                ))}
                <td>
                  <button title="Delete row" onClick={() => void p.onDeleteRow(row.id)}>×</button>
                </td>
              </tr>
            ))}
          </React.Fragment>
        ))}
        <tr>
          <td colSpan={span}>
            <button className="db-add-row" onClick={() => void p.onAddRow()}>
              + New
            </button>
          </td>
        </tr>
      </tbody>
    </table>
  )
}

function TitleCell({
  row,
  onRename,
  onOpen,
}: {
  row: Page
  onRename: (id: string, title: string) => Promise<void>
  onOpen: (id: string) => void
}) {
  const [value, setValue] = useState(row.title)
  return (
    <span className="db-title-cell">
      <input
        value={value}
        placeholder="Untitled"
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          if (value !== row.title) void onRename(row.id, value)
        }}
      />
      <button title="Open as page" onClick={() => onOpen(row.id)}>
        ↗
      </button>
    </span>
  )
}

function Cell({
  prop,
  row,
  pages,
  schema,
  onSetCell,
  onUploadFiles,
}: {
  prop: PropertyDef
  row: Page
  pages: Page[]
  schema: DbSchema
  onSetCell: (row: Page, prop: PropertyDef, raw: string | boolean) => Promise<void>
  onUploadFiles: (row: Page, prop: PropertyDef, files: File[]) => Promise<void>
}) {
  const stored = formatValue(prop.type, row.props?.[prop.id])
  if (prop.type === 'relation') {
    const linked = Array.isArray(row.props?.[prop.id]) ? (row.props![prop.id] as string[]) : []
    const candidates = pages.filter((pg) => pg.parent_id === prop.relationTarget)
    return <div className="db-chip-cell">{candidates.map((page) => {
      const selected = linked.includes(page.id)
      return <button key={page.id} aria-pressed={selected} onClick={() => {
        const next = selected ? linked.filter((id) => id !== page.id) : [...linked, page.id]
        void onSetCell(row, prop, next.join(','))
      }}>{page.title || 'Untitled'}</button>
    })}</div>
  }
  if (prop.type === 'rollup') {
    const relProp = schema.properties.find((pr) => pr.id === prop.rollupRelation)
    const linkedIds = Array.isArray(row.props?.[relProp?.id ?? '']) ? (row.props![relProp!.id] as string[]) : []
    const targets = pages.filter((pg) => linkedIds.includes(pg.id))
    const values = targets.map((pg) =>
      prop.rollupProperty ? pg.props?.[prop.rollupProperty] : pg.title,
    )
    const computed = computeRollup(prop.rollupFn ?? 'show', values)
    return <span className="db-rollup-cell">{computed || '—'}</span>
  }
  if (prop.type === 'formula') {
    return <span className="db-computed-cell">{evaluateFormula(prop.formula ?? '', row, schema) || '—'}</span>
  }
  if (prop.type === 'created-time' || prop.type === 'last-edited-time') {
    const timestamp = prop.type === 'created-time' ? row.created_at : row.updated_at
    return <time className="db-computed-cell" dateTime={timestamp}>{new Date(timestamp).toLocaleString()}</time>
  }
  if (prop.type === 'created-by' || prop.type === 'last-edited-by') {
    return <span className="db-person-cell">You</span>
  }
  if (prop.type === 'files') {
    const files = Array.isArray(row.props?.[prop.id])
      ? (row.props![prop.id] as unknown[]).filter((value): value is string => typeof value === 'string')
      : []
    const shell = getShell()
    return (
      <div className="db-files-cell">
        {files.map((file) => (
          <a key={file} href={attachmentDisplayUrl(file, shell.isDesktop)} target="_blank" rel="noreferrer">
            {file.replace(/^.*\//, '').replace(/^[0-9a-f-]{36}-/, '')}
          </a>
        ))}
        <label>
          + Add
          <input
            type="file"
            multiple
            aria-label={`Add files to ${prop.name}`}
            onChange={(event) => {
              const chosen = Array.from(event.target.files ?? [])
              if (chosen.length > 0) void onUploadFiles(row, prop, chosen)
              event.target.value = ''
            }}
          />
        </label>
      </div>
    )
  }
  if (prop.type === 'checkbox') {
    return (
      <input
        type="checkbox"
        checked={stored === 'true'}
        onChange={(e) => void onSetCell(row, prop, e.target.checked)}
      />
    )
  }
  if (prop.type === 'multi-select') {
    const chosen = Array.isArray(row.props?.[prop.id]) ? (row.props![prop.id] as string[]) : []
    return <div className="db-chip-cell">{(prop.options ?? []).map((option) => {
      const selected = chosen.includes(option)
      return <button key={option} aria-pressed={selected} onClick={() => {
        const next = selected ? chosen.filter((value) => value !== option) : [...chosen, option]
        void onSetCell(row, prop, next.join(','))
      }}>{option}</button>
    })}</div>
  }
  if (prop.type === 'select' || prop.type === 'status') {
    const select = (
      <select value={stored} onChange={(e) => void onSetCell(row, prop, e.target.value)}>
        <option value="">—</option>
        {(prop.options ?? []).map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    )
    if (prop.type === 'status') {
      return (
        <span className="db-status-cell" data-color={stored ? statusColor(stored) : 'none'}>
          {stored && <span className="db-status-dot" aria-hidden="true" />}
          {select}
        </span>
      )
    }
    return select
  }
  return (
    <EditableCell key={stored} type={prop.type} initial={stored} onCommit={(v) => void onSetCell(row, prop, v)} />
  )
}

function EditableCell({
  type,
  initial,
  onCommit,
}: {
  type: PropertyType
  initial: string
  onCommit: (v: string) => void
}) {
  const [value, setValue] = useState(initial)
  return (
    <input
      type={
        type === 'number' ? 'number'
          : type === 'date' ? 'date'
          : type === 'email' ? 'email'
          : type === 'phone' ? 'tel'
          : type === 'url' ? 'url'
          : 'text'
      }
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => {
        if (value !== initial) onCommit(value)
      }}
    />
  )
}

/* ---------------- board ---------------- */

function BoardView({
  schema,
  view,
  rows,
  onOpenRow,
  onSetCell,
  onAddRow,
  onReorderRow,
}: {
  schema: DbSchema
  view: ViewDef
  rows: Page[]
  onOpenRow: (id: string) => void
  onSetCell: (row: Page, prop: PropertyDef, raw: string | boolean) => Promise<void>
  onAddRow: () => Promise<void>
  onReorderRow: (id: string, beforeId: string) => Promise<void>
}) {
  const isGroupable = (p: PropertyDef) => p.type === 'select' || p.type === 'status'
  const groupProp =
    schema.properties.find((p) => p.id === view.groupBy && isGroupable(p)) ??
    schema.properties.find(isGroupable)
  if (!groupProp) {
    return <p className="db-hint">Board views need a select or status property.</p>
  }
  const columns = [...(groupProp.options ?? []), ''] // '' = ungrouped
  return (
    <div className="db-board">
      {columns.map((col) => {
        const cards = rows.filter(
          (r) => formatValue('select', r.props?.[groupProp.id]) === col,
        )
        return (
          <div key={col || '__none'} className="db-board-col">
            <h4>
              {col || 'No value'} <span className="db-count">{cards.length}</span>
            </h4>
            {cards.map((r) => (
              <div
                key={r.id}
                className="db-card"
                draggable
                onDragStart={(event) => event.dataTransfer.setData('application/x-opennote-row', r.id)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  const draggedId = event.dataTransfer.getData('application/x-opennote-row')
                  if (draggedId && draggedId !== r.id) void onReorderRow(draggedId, r.id)
                }}
                onClick={() => onOpenRow(r.id)}
              >
                <span>{r.title || 'Untitled'}</span>
                <select
                  value={col}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => void onSetCell(r, groupProp, e.target.value)}
                >
                  <option value="">—</option>
                  {(groupProp.options ?? []).map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        )
      })}
      <button className="db-add-row" onClick={() => void onAddRow()}>
        + New
      </button>
    </div>
  )
}

/* ---------------- calendar ---------------- */

function CalendarView({
  schema,
  view,
  rows,
  onOpenRow,
}: {
  schema: DbSchema
  view: ViewDef
  rows: Page[]
  onOpenRow: (id: string) => void
}) {
  const dateProp =
    schema.properties.find((p) => p.id === view.groupBy && p.type === 'date') ??
    schema.properties.find((p) => p.type === 'date')
  const [month, setMonth] = useState(() => {
    const now = new Date()
    return { y: now.getFullYear(), m: now.getMonth() } // m: 0-11
  })
  if (!dateProp) {
    return <p className="db-hint">Calendar views need a date property.</p>
  }
  const first = new Date(month.y, month.m, 1)
  const daysInMonth = new Date(month.y, month.m + 1, 0).getDate()
  const leadingBlanks = first.getDay() // 0 = Sunday
  const iso = (day: number) =>
    `${month.y}-${String(month.m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  const byDay = new Map<string, Page[]>()
  for (const r of rows) {
    const d = formatValue('date', r.props?.[dateProp.id])
    if (!d) continue
    byDay.set(d, [...(byDay.get(d) ?? []), r])
  }
  const cells: Array<number | null> = [
    ...Array.from({ length: leadingBlanks }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  return (
    <div className="db-calendar">
      <div className="db-cal-nav">
        <button onClick={() => setMonth(({ y, m }) => (m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 }))}>
          ‹
        </button>
        <strong>
          {month.y}-{String(month.m + 1).padStart(2, '0')}
        </strong>
        <button onClick={() => setMonth(({ y, m }) => (m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 }))}>
          ›
        </button>
      </div>
      <div className="db-cal-grid">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
          <div key={d} className="db-cal-head">
            {d}
          </div>
        ))}
        {cells.map((day, i) =>
          day === null ? (
            <div key={`b${i}`} className="db-cal-cell blank" />
          ) : (
            <div key={day} className="db-cal-cell">
              <span className="db-cal-day">{day}</span>
              {(byDay.get(iso(day)) ?? []).map((r) => (
                <div key={r.id} className="db-card" onClick={() => onOpenRow(r.id)}>
                  {r.title || 'Untitled'}
                </div>
              ))}
            </div>
          ),
        )}
      </div>
    </div>
  )
}

function ListView({
  schema,
  rows,
  onOpenRow,
  onAddRow,
}: {
  schema: DbSchema
  rows: Page[]
  onOpenRow: (id: string) => void
  onAddRow: () => Promise<void>
}) {
  return (
    <div className="db-list">
      {rows.map((row) => (
        <button key={row.id} onClick={() => onOpenRow(row.id)}>
          <span>{row.icon || '📄'} {row.title || 'Untitled'}</span>
          <small>{schema.properties.slice(0, 2).map((property) => formatValue(property.type, row.props?.[property.id])).filter(Boolean).join(' · ')}</small>
        </button>
      ))}
      <button className="db-add-row" onClick={() => void onAddRow()}>+ New</button>
    </div>
  )
}

function GalleryView({
  rows,
  onOpenRow,
  onAddRow,
}: {
  rows: Page[]
  onOpenRow: (id: string) => void
  onAddRow: () => Promise<void>
}) {
  return (
    <div className="db-gallery">
      {rows.map((row) => (
        <button key={row.id} onClick={() => onOpenRow(row.id)}>
          <span className="db-gallery-preview">{row.icon || '📄'}</span>
          <strong>{row.title || 'Untitled'}</strong>
        </button>
      ))}
      <button className="db-gallery-add" onClick={() => void onAddRow()}>+ New</button>
    </div>
  )
}

function TimelineView({
  schema,
  view,
  rows,
  onOpenRow,
}: {
  schema: DbSchema
  view: ViewDef
  rows: Page[]
  onOpenRow: (id: string) => void
}) {
  const dateProperty = schema.properties.find(
    (property) => property.id === view.groupBy && (property.type === 'date' || property.type === 'created-time'),
  ) ?? schema.properties.find((property) => property.type === 'date' || property.type === 'created-time')
  if (!dateProperty) return <p className="db-hint">Timeline views need a date property.</p>
  const dated = rows.map((row) => ({
    row,
    date: dateProperty.type === 'created-time' ? row.created_at : formatValue('date', row.props?.[dateProperty.id]),
  })).filter((item) => item.date).sort((a, b) => a.date.localeCompare(b.date))
  return (
    <div className="db-timeline">
      {dated.map(({ row, date }) => (
        <button key={row.id} onClick={() => onOpenRow(row.id)}>
          <time dateTime={date}>{date.slice(0, 10)}</time>
          <span>{row.icon || '📄'} {row.title || 'Untitled'}</span>
        </button>
      ))}
    </div>
  )
}
