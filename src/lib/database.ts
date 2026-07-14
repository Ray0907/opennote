/**
 * Database-page schema model (M3).
 *
 * A database page stores its property definitions + view configs in
 * pages.db_schema (JSONB); each row is a child page whose typed values
 * live in pages.props keyed by property id. Both replicate through the
 * ordinary page LWW path — no new sync machinery.
 */

export type PropertyType =
  | 'text' | 'number' | 'select' | 'date' | 'checkbox'
  | 'multi-select' | 'url' | 'relation' | 'rollup'

export type RollupFn = 'count' | 'sum' | 'avg' | 'min' | 'max' | 'show'

export interface PropertyDef {
  id: string
  name: string
  type: PropertyType
  /** Option labels, for type 'select' and 'multi-select'. */
  options?: string[]
  /** relation: page id of the target database. */
  relationTarget?: string
  /** rollup: id of the relation property (on this database) to follow. */
  rollupRelation?: string
  /** rollup: property id on the target database to aggregate. */
  rollupProperty?: string
  /** rollup: aggregation. Default 'show'. */
  rollupFn?: RollupFn
}

export type ViewKind = 'table' | 'board' | 'calendar'

export interface ViewDef {
  id: string
  kind: ViewKind
  name: string
  /** Board: property id to group by (must be a select). Calendar: date property id. */
  groupBy?: string
  sortBy?: string
  sortDir?: 'asc' | 'desc'
  filter?: { property: string; equals: unknown } | null
}

export interface DbSchema {
  properties: PropertyDef[]
  views: ViewDef[]
}

let counter = 0
/** Short unique-enough id for schema-local entities (not synced rows). */
export function localId(prefix: string): string {
  counter += 1
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}`
}

export function createDefaultSchema(): DbSchema {
  return {
    properties: [
      { id: localId('prop'), name: 'Status', type: 'select', options: ['Todo', 'Doing', 'Done'] },
      { id: localId('prop'), name: 'Date', type: 'date' },
    ],
    views: [{ id: localId('view'), kind: 'table', name: 'Table' }],
  }
}

/** Parse whatever is in pages.db_schema into a usable schema, tolerating junk. */
export function normalizeSchema(raw: unknown): DbSchema {
  const out: DbSchema = { properties: [], views: [] }
  if (raw && typeof raw === 'object') {
    const r = raw as Partial<DbSchema>
    if (Array.isArray(r.properties)) {
      for (const p of r.properties) {
        if (!p || typeof p !== 'object') continue
        const { id, name, type } = p as PropertyDef
        if (typeof id !== 'string' || typeof name !== 'string') continue
        if (!isPropertyType(type)) continue
        const def: PropertyDef = { id, name, type }
        if (type === 'select' || type === 'multi-select') {
          def.options = Array.isArray(p.options)
            ? p.options.filter((o): o is string => typeof o === 'string')
            : []
        }
        if (type === 'relation' && typeof p.relationTarget === 'string') {
          def.relationTarget = p.relationTarget
        }
        if (type === 'rollup') {
          if (typeof p.rollupRelation === 'string') def.rollupRelation = p.rollupRelation
          if (typeof p.rollupProperty === 'string') def.rollupProperty = p.rollupProperty
          def.rollupFn = isRollupFn(p.rollupFn) ? p.rollupFn : 'show'
        }
        out.properties.push(def)
      }
    }
    if (Array.isArray(r.views)) {
      for (const v of r.views) {
        if (!v || typeof v !== 'object') continue
        const { id, kind, name } = v as ViewDef
        if (typeof id !== 'string' || typeof name !== 'string') continue
        if (kind !== 'table' && kind !== 'board' && kind !== 'calendar') continue
        out.views.push({ ...(v as ViewDef) })
      }
    }
  }
  if (out.views.length === 0) {
    out.views.push({ id: localId('view'), kind: 'table', name: 'Table' })
  }
  return out
}

const PROPERTY_TYPES: readonly PropertyType[] = [
  'text', 'number', 'select', 'date', 'checkbox',
  'multi-select', 'url', 'relation', 'rollup',
]

function isPropertyType(t: unknown): t is PropertyType {
  return typeof t === 'string' && (PROPERTY_TYPES as readonly string[]).includes(t)
}

const ROLLUP_FNS: readonly RollupFn[] = ['count', 'sum', 'avg', 'min', 'max', 'show']

function isRollupFn(f: unknown): f is RollupFn {
  return typeof f === 'string' && (ROLLUP_FNS as readonly string[]).includes(f)
}

/** Coerce a raw cell edit (always a string from <input>) to the property's storage type. */
export function coerceValue(type: PropertyType, raw: string | boolean): unknown {
  if (type === 'checkbox') return raw === true || raw === 'true'
  if (type === 'rollup') return null // computed, never stored
  if (typeof raw !== 'string') return null
  const s = raw.trim()
  if (s === '') return null
  if (type === 'number') {
    const n = Number(s)
    return Number.isFinite(n) ? n : null
  }
  if (type === 'multi-select' || type === 'relation') {
    const items = s.split(',').map((x) => x.trim()).filter((x) => x !== '')
    return items.length > 0 ? items : null
  }
  return s // text, select, date (ISO yyyy-mm-dd from <input type=date>), url
}

/** Render a stored value for display/editing. */
export function formatValue(type: PropertyType, value: unknown): string {
  if (value === null || value === undefined) return ''
  if (type === 'checkbox') return value === true ? 'true' : 'false'
  if (type === 'number') return typeof value === 'number' ? String(value) : ''
  if (type === 'multi-select' || type === 'relation') {
    return Array.isArray(value)
      ? value.filter((v): v is string => typeof v === 'string').join(', ')
      : ''
  }
  return typeof value === 'string' ? value : ''
}

/** Aggregate values of the rollup's target property across related rows. */
export function computeRollup(fn: RollupFn, values: unknown[]): string {
  if (fn === 'count') return String(values.filter((v) => v !== null && v !== undefined).length)
  if (fn === 'show') {
    return values
      .map((v) => (Array.isArray(v) ? v.join(', ') : v === null || v === undefined ? '' : String(v)))
      .filter((s) => s !== '')
      .join(', ')
  }
  const nums = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  if (nums.length === 0) return ''
  if (fn === 'sum') return String(nums.reduce((a, b) => a + b, 0))
  if (fn === 'avg') return String(nums.reduce((a, b) => a + b, 0) / nums.length)
  if (fn === 'min') return String(Math.min(...nums))
  return String(Math.max(...nums)) // max
}
