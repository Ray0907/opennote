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
  | 'multi-select' | 'url' | 'email' | 'phone' | 'relation' | 'rollup' | 'formula'
  | 'person' | 'created-time' | 'last-edited-time'
  | 'created-by' | 'last-edited-by' | 'files'

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
  /** formula: safe expression with property references such as [Price] * [Qty]. */
  formula?: string
}

export type ViewKind = 'table' | 'board' | 'calendar' | 'list' | 'gallery' | 'timeline'

export interface ViewDef {
  id: string
  kind: ViewKind
  name: string
  /** Board: property id to group by (must be a select). Calendar: date property id. */
  groupBy?: string
  sortBy?: string
  sortDir?: 'asc' | 'desc'
  filter?: { property: string; equals: unknown } | null
  /** Property ids hidden in this view; absent/empty means all are shown. */
  hiddenProps?: string[]
}

export interface DbSchema {
  properties: PropertyDef[]
  views: ViewDef[]
}

export interface ViewRow {
  title: string
  props?: Record<string, unknown> | null
  created_at?: string
  updated_at?: string
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
        if (type === 'formula' && typeof p.formula === 'string') def.formula = p.formula
        out.properties.push(def)
      }
    }
    if (Array.isArray(r.views)) {
      for (const v of r.views) {
        if (!v || typeof v !== 'object') continue
        const { id, kind, name } = v as ViewDef
        if (typeof id !== 'string' || typeof name !== 'string') continue
        if (!['table', 'board', 'calendar', 'list', 'gallery', 'timeline'].includes(kind)) continue
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
  'multi-select', 'url', 'email', 'phone', 'relation', 'rollup', 'formula', 'person',
  'created-time', 'last-edited-time', 'created-by', 'last-edited-by', 'files',
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
  if (type === 'rollup' || type === 'formula' || type === 'created-time' ||
      type === 'last-edited-time' || type === 'created-by' || type === 'last-edited-by') return null
  if (typeof raw !== 'string') return null
  const s = raw.trim()
  if (s === '') return null
  if (type === 'number') {
    const n = Number(s)
    return Number.isFinite(n) ? n : null
  }
  if (type === 'multi-select' || type === 'relation' || type === 'files') {
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
  if (type === 'multi-select' || type === 'relation' || type === 'files') {
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

function viewValue(row: ViewRow, property: string, schema?: DbSchema): unknown {
  if (property === 'title') return row.title
  const definition = schema?.properties.find((candidate) => candidate.id === property)
  if (definition?.type === 'formula') return evaluateFormula(definition.formula ?? '', row, schema!)
  if (definition?.type === 'created-time') return row.created_at
  if (definition?.type === 'last-edited-time') return row.updated_at
  if (definition?.type === 'created-by' || definition?.type === 'last-edited-by') return 'You'
  return row.props?.[property]
}

function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)
}

/** Apply one persisted database view without mutating the repository rows. */
export function applyView<T extends ViewRow>(rows: T[], view: ViewDef, schema?: DbSchema): T[] {
  const filtered = view.filter
    ? rows.filter((row) => {
        const actual = viewValue(row, view.filter!.property, schema)
        const expected = view.filter!.equals
        if (isEmpty(expected)) return isEmpty(actual)
        if (Array.isArray(actual)) return actual.includes(expected)
        return actual === expected
      })
    : rows.slice()

  if (!view.sortBy) return filtered
  const direction = view.sortDir === 'desc' ? -1 : 1
  return filtered
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const av = viewValue(a.row, view.sortBy!, schema)
      const bv = viewValue(b.row, view.sortBy!, schema)
      if (isEmpty(av) || isEmpty(bv)) {
        if (isEmpty(av) && isEmpty(bv)) return a.index - b.index
        return isEmpty(av) ? 1 : -1
      }
      const compared =
        typeof av === 'number' && typeof bv === 'number'
          ? av - bv
          : String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' })
      return compared === 0 ? a.index - b.index : compared * direction
    })
    .map(({ row }) => row)
}

/** Evaluate the deliberately small, side-effect-free database formula grammar. */
export function evaluateFormula(expression: string, row: ViewRow, schema: DbSchema): string {
  let index = 0
  const skip = () => {
    while (/\s/.test(expression[index] ?? '')) index++
  }
  const numeric = (value: string | number): number => {
    const number = typeof value === 'number' ? value : value.trim() === '' ? NaN : Number(value)
    if (!Number.isFinite(number)) throw new Error('Expected number')
    return number
  }
  const parsePrimary = (): string | number => {
    skip()
    if (expression[index] === '(') {
      index++
      const value = parseExpression()
      skip()
      if (expression[index++] !== ')') throw new Error('Missing )')
      return value
    }
    if (expression[index] === '"' || expression[index] === "'") {
      const quote = expression[index++]
      let value = ''
      while (index < expression.length && expression[index] !== quote) {
        if (expression[index] === '\\' && index + 1 < expression.length) index++
        value += expression[index++]
      }
      if (expression[index++] !== quote) throw new Error('Missing quote')
      return value
    }
    if (expression[index] === '[') {
      const end = expression.indexOf(']', index + 1)
      if (end === -1) throw new Error('Missing ]')
      const name = expression.slice(index + 1, end).trim()
      index = end + 1
      const property = schema.properties.find((candidate) => candidate.name.toLowerCase() === name.toLowerCase())
      const value = name.toLowerCase() === 'title' ? row.title : property ? row.props?.[property.id] : undefined
      if (typeof value !== 'string' && typeof value !== 'number') throw new Error('Missing value')
      return value
    }
    const number = /^(?:\d+(?:\.\d*)?|\.\d+)/.exec(expression.slice(index))?.[0]
    if (!number) throw new Error('Expected value')
    index += number.length
    return Number(number)
  }
  const parseUnary = (): string | number => {
    skip()
    if (expression[index] === '-') {
      index++
      return -numeric(parseUnary())
    }
    return parsePrimary()
  }
  const parseTerm = (): string | number => {
    let value = parseUnary()
    while (true) {
      skip()
      const operator = expression[index]
      if (operator !== '*' && operator !== '/') break
      index++
      const right = numeric(parseUnary())
      value = operator === '*' ? numeric(value) * right : right === 0 ? NaN : numeric(value) / right
      if (!Number.isFinite(value)) throw new Error('Invalid arithmetic')
    }
    return value
  }
  const parseExpression = (): string | number => {
    let value = parseTerm()
    while (true) {
      skip()
      const operator = expression[index]
      if (operator !== '+' && operator !== '-') break
      index++
      const right = parseTerm()
      value = operator === '+'
        ? typeof value === 'number' && typeof right === 'number' ? value + right : String(value) + String(right)
        : numeric(value) - numeric(right)
    }
    return value
  }
  try {
    const value = parseExpression()
    skip()
    return index === expression.length ? String(value) : ''
  } catch {
    return ''
  }
}

/** Property defs shown in a view — all properties minus the view's hidden set. */
export function visibleProperties(schema: DbSchema, view: ViewDef): PropertyDef[] {
  const hidden = new Set(Array.isArray(view.hiddenProps) ? view.hiddenProps : [])
  return schema.properties.filter((p) => !hidden.has(p.id))
}

export function groupRows<T extends ViewRow>(rows: T[], property: string, schema?: DbSchema): Array<{ label: string; rows: T[] }> {
  const groups = new Map<string, { label: string; rows: T[] }>()
  const empty: T[] = []
  for (const row of rows) {
    const value = viewValue(row, property, schema)
    if (isEmpty(value)) {
      empty.push(row)
      continue
    }
    const label = Array.isArray(value) ? value.join(', ') : value === true ? 'Checked' : value === false ? 'Unchecked' : String(value)
    const key = `${typeof value}:${label}`
    const group = groups.get(key) ?? { label, rows: [] }
    group.rows.push(row)
    groups.set(key, group)
  }
  return [...groups.values(), ...(empty.length > 0 ? [{ label: 'No value', rows: empty }] : [])]
}
