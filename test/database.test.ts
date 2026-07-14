import { describe, expect, it } from 'vitest'
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
} from '../src/lib/database'

describe('database schema helpers', () => {
  it('localId is unique across calls', () => {
    const a = localId('p')
    const b = localId('p')
    expect(a).not.toBe(b)
    expect(a.startsWith('p_')).toBe(true)
  })

  it('createDefaultSchema has a select Status, a date, and one table view', () => {
    const s = createDefaultSchema()
    expect(s.properties.map((p) => p.type)).toEqual(['select', 'date'])
    expect(s.properties[0].options).toEqual(['Todo', 'Doing', 'Done'])
    expect(s.views).toHaveLength(1)
    expect(s.views[0].kind).toBe('table')
  })

  it('normalizeSchema round-trips a valid schema', () => {
    const s = createDefaultSchema()
    expect(normalizeSchema(JSON.parse(JSON.stringify(s)))).toEqual(s)
  })

  it('normalizeSchema tolerates junk and always yields a view', () => {
    for (const junk of [null, undefined, 42, 'x', [], {}, { properties: 'nope', views: 7 }]) {
      const s = normalizeSchema(junk)
      expect(s.properties).toEqual([])
      expect(s.views.length).toBe(1)
      expect(s.views[0].kind).toBe('table')
    }
  })

  it('normalizeSchema drops malformed entries but keeps good ones', () => {
    const s = normalizeSchema({
      properties: [
        { id: 'a', name: 'A', type: 'text' },
        { id: 1, name: 'bad-id', type: 'text' },
        { id: 'b', name: 'B', type: 'wormhole' },
        { id: 'c', name: 'C', type: 'select', options: ['x', 3, 'y'] },
        'garbage',
      ],
      views: [{ id: 'v', kind: 'board', name: 'Board', groupBy: 'c' }, { kind: 'table' }, null],
    })
    expect(s.properties.map((p) => p.id)).toEqual(['a', 'c'])
    expect(s.properties[1].options).toEqual(['x', 'y'])
    expect(s.views).toHaveLength(1)
    expect(s.views[0]).toMatchObject({ kind: 'board', groupBy: 'c' })
  })

  it('normalizes list, gallery, and timeline views', () => {
    const schema = normalizeSchema({
      properties: [],
      views: [
        { id: 'list', kind: 'list', name: 'List' },
        { id: 'gallery', kind: 'gallery', name: 'Gallery' },
        { id: 'timeline', kind: 'timeline', name: 'Timeline', groupBy: 'date' },
      ],
    })
    expect(schema.views.map((view) => view.kind)).toEqual(['list', 'gallery', 'timeline'])
  })

  it('coerceValue converts by type', () => {
    expect(coerceValue('number', '42')).toBe(42)
    expect(coerceValue('number', 'abc')).toBeNull()
    expect(coerceValue('number', '')).toBeNull()
    expect(coerceValue('checkbox', 'true')).toBe(true)
    expect(coerceValue('checkbox', true)).toBe(true)
    expect(coerceValue('checkbox', 'false')).toBe(false)
    expect(coerceValue('text', '  hi  ')).toBe('hi')
    expect(coerceValue('date', '2026-07-14')).toBe('2026-07-14')
    expect(coerceValue('select', 'Todo')).toBe('Todo')
  })

  it('formatValue renders stored values and blanks out mismatches', () => {
    expect(formatValue('number', 42)).toBe('42')
    expect(formatValue('number', 'x')).toBe('')
    expect(formatValue('text', 'hi')).toBe('hi')
    expect(formatValue('checkbox', true)).toBe('true')
    expect(formatValue('date', null)).toBe('')
    expect(formatValue('select', undefined)).toBe('')
  })

  it('coerceValue splits multi-select and relation into trimmed arrays', () => {
    expect(coerceValue('multi-select', 'a, b ,c')).toEqual(['a', 'b', 'c'])
    expect(coerceValue('multi-select', ' , ,')).toBeNull()
    expect(coerceValue('multi-select', '')).toBeNull()
    expect(coerceValue('relation', 'p1,p2')).toEqual(['p1', 'p2'])
    expect(coerceValue('rollup', 'anything')).toBeNull()
    expect(coerceValue('files', 'attachments/a.pdf, attachments/b.png')).toEqual([
      'attachments/a.pdf',
      'attachments/b.png',
    ])
    expect(coerceValue('formula', 'anything')).toBeNull()
  })

  it('formatValue joins arrays and drops non-strings', () => {
    expect(formatValue('multi-select', ['a', 'b'])).toBe('a, b')
    expect(formatValue('multi-select', ['a', 3, 'b'])).toBe('a, b')
    expect(formatValue('multi-select', 'not-array')).toBe('')
    expect(formatValue('relation', ['p1'])).toBe('p1')
    expect(formatValue('files', ['attachments/a.pdf'])).toBe('attachments/a.pdf')
  })

  it('computeRollup aggregates', () => {
    expect(computeRollup('count', [1, null, 'x', undefined])).toBe('2')
    expect(computeRollup('sum', [1, 2, 'x', null])).toBe('3')
    expect(computeRollup('avg', [2, 4])).toBe('3')
    expect(computeRollup('min', [5, 2, 9])).toBe('2')
    expect(computeRollup('max', [5, 2, 9])).toBe('9')
    expect(computeRollup('sum', ['a', null])).toBe('')
    expect(computeRollup('show', ['a', ['b', 'c'], null, 7])).toBe('a, b, c, 7')
  })

  it('applyView filters scalar and multi-value properties', () => {
    const rows = [
      { id: 'a', title: 'Alpha', props: { status: 'Doing', tags: ['one', 'two'] } },
      { id: 'b', title: 'Beta', props: { status: 'Done', tags: ['two'] } },
      { id: 'c', title: 'Gamma', props: {} },
    ]

    expect(
      applyView(rows, { id: 'v', kind: 'table', name: 'Table', filter: { property: 'status', equals: 'Doing' } }),
    ).toEqual([rows[0]])
    expect(
      applyView(rows, { id: 'v', kind: 'table', name: 'Table', filter: { property: 'tags', equals: 'two' } }),
    ).toEqual([rows[0], rows[1]])
    expect(
      applyView(rows, { id: 'v', kind: 'table', name: 'Table', filter: { property: 'title', equals: 'Beta' } }),
    ).toEqual([rows[1]])
  })

  it('applyView sorts by title or property without mutating input and keeps empty values last', () => {
    const rows = [
      { id: 'a', title: 'Zulu', props: { score: 2 } },
      { id: 'b', title: 'alpha', props: { score: null } },
      { id: 'c', title: 'Bravo', props: { score: 10 } },
    ]

    expect(
      applyView(rows, { id: 'v', kind: 'table', name: 'Table', sortBy: 'title', sortDir: 'asc' }).map((r) => r.id),
    ).toEqual(['b', 'c', 'a'])
    expect(
      applyView(rows, { id: 'v', kind: 'table', name: 'Table', sortBy: 'score', sortDir: 'desc' }).map((r) => r.id),
    ).toEqual(['c', 'a', 'b'])
    expect(rows.map((r) => r.id)).toEqual(['a', 'b', 'c'])
  })

  it('evaluates safe formulas with property references, arithmetic, and strings', () => {
    const schema = {
      properties: [
        { id: 'price', name: 'Price', type: 'number' as const },
        { id: 'qty', name: 'Qty', type: 'number' as const },
      ],
      views: [],
    }
    const row = { title: 'Widget', props: { price: 2.5, qty: 4 } }
    expect(evaluateFormula('[Price] * [Qty]', row, schema)).toBe('10')
    expect(evaluateFormula('"Total: " + ([Price] * [Qty])', row, schema)).toBe('Total: 10')
    expect(evaluateFormula('[Title] + " / " + [Qty]', row, schema)).toBe('Widget / 4')
    expect(evaluateFormula('[Price] / 0', row, schema)).toBe('')
    expect(evaluateFormula('[Missing] + 1', row, schema)).toBe('')
  })

  it('groups rows stably and keeps empty values in a named final group', () => {
    const rows = [
      { id: 'a', title: 'A', props: { status: 'Doing' } },
      { id: 'b', title: 'B', props: {} },
      { id: 'c', title: 'C', props: { status: 'Doing' } },
      { id: 'd', title: 'D', props: { status: 'Done' } },
    ]
    expect(groupRows(rows, 'status').map((group) => ({ label: group.label, ids: group.rows.map((row) => row.id) }))).toEqual([
      { label: 'Doing', ids: ['a', 'c'] },
      { label: 'Done', ids: ['d'] },
      { label: 'No value', ids: ['b'] },
    ])
  })
})
