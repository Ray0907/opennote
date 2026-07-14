import React, { useMemo, useState } from 'react'
import type { PGlite } from '@electric-sql/pglite'
import type { Page } from '../db/repo'
import * as repo from '../db/repo'
import {
  coerceValue,
  computeRollup,
  createDefaultSchema,
  formatValue,
  localId,
  normalizeSchema,
  type DbSchema,
  type PropertyDef,
  type PropertyType,
  type ViewDef,
} from '../lib/database'
import { AddPropertyPopover } from './AddPropertyPopover'

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
    if (kind === 'board') v.groupBy = schema.properties.find((p) => p.type === 'select')?.id
    if (kind === 'calendar') v.groupBy = schema.properties.find((p) => p.type === 'date')?.id
    await saveSchema({ ...schema, views: [...schema.views, v] })
    setActiveViewId(v.id)
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
        <button onClick={() => void addView('table')}>+ Table</button>
        <button onClick={() => void addView('board')}>+ Board</button>
        <button onClick={() => void addView('calendar')}>+ Calendar</button>
      </div>
      {view.kind === 'table' && (
        <TableView
          schema={schema}
          rows={rows}
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
        />
      )}
      {view.kind === 'board' && (
        <BoardView schema={schema} view={view} rows={rows} onOpenRow={onOpenRow} onSetCell={setCell} onAddRow={addRow} />
      )}
      {view.kind === 'calendar' && (
        <CalendarView schema={schema} view={view} rows={rows} onOpenRow={onOpenRow} />
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
}

function TableView(p: TableViewProps) {
  return (
    <table className="db-table">
      <thead>
        <tr>
          <th>Title</th>
          {p.schema.properties.map((prop) => (
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
        {p.rows.map((row) => (
          <tr key={row.id}>
            <td>
              <TitleCell row={row} onRename={p.onRenameRow} onOpen={p.onOpenRow} />
            </td>
            {p.schema.properties.map((prop) => (
              <td key={prop.id}>
                <Cell prop={prop} row={row} pages={p.pages} schema={p.schema} onSetCell={p.onSetCell} />
              </td>
            ))}
            <td>
              <button title="Delete row" onClick={() => void p.onDeleteRow(row.id)}>
                ×
              </button>
            </td>
          </tr>
        ))}
        <tr>
          <td colSpan={p.schema.properties.length + 2}>
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
}: {
  prop: PropertyDef
  row: Page
  pages: Page[]
  schema: DbSchema
  onSetCell: (row: Page, prop: PropertyDef, raw: string | boolean) => Promise<void>
}) {
  const stored = formatValue(prop.type, row.props?.[prop.id])
  if (prop.type === 'relation') {
    const linked = Array.isArray(row.props?.[prop.id]) ? (row.props![prop.id] as string[]) : []
    const candidates = pages.filter((pg) => pg.parent_id === prop.relationTarget)
    return (
      <select
        multiple
        value={linked}
        className="db-relation-cell"
        onChange={(e) =>
          void onSetCell(
            row,
            prop,
            Array.from(e.target.selectedOptions, (o) => o.value).join(','),
          )
        }
      >
        {candidates.map((pg) => (
          <option key={pg.id} value={pg.id}>
            {pg.title || 'Untitled'}
          </option>
        ))}
      </select>
    )
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
    return (
      <select
        multiple
        value={chosen}
        className="db-multiselect-cell"
        onChange={(e) =>
          void onSetCell(
            row,
            prop,
            Array.from(e.target.selectedOptions, (o) => o.value).join(','),
          )
        }
      >
        {(prop.options ?? []).map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    )
  }
  if (prop.type === 'select') {
    return (
      <select value={stored} onChange={(e) => void onSetCell(row, prop, e.target.value)}>
        <option value="">—</option>
        {(prop.options ?? []).map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    )
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
      type={type === 'number' ? 'number' : type === 'date' ? 'date' : 'text'}
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
}: {
  schema: DbSchema
  view: ViewDef
  rows: Page[]
  onOpenRow: (id: string) => void
  onSetCell: (row: Page, prop: PropertyDef, raw: string | boolean) => Promise<void>
  onAddRow: () => Promise<void>
}) {
  const groupProp =
    schema.properties.find((p) => p.id === view.groupBy && p.type === 'select') ??
    schema.properties.find((p) => p.type === 'select')
  if (!groupProp) {
    return <p className="db-hint">Board views need a select property.</p>
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
              <div key={r.id} className="db-card" onClick={() => onOpenRow(r.id)}>
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
