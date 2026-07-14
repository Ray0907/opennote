import { describe, expect, it } from 'vitest'
import {
  coerceValue,
  computeRollup,
  createDefaultSchema,
  formatValue,
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
  })

  it('formatValue joins arrays and drops non-strings', () => {
    expect(formatValue('multi-select', ['a', 'b'])).toBe('a, b')
    expect(formatValue('multi-select', ['a', 3, 'b'])).toBe('a, b')
    expect(formatValue('multi-select', 'not-array')).toBe('')
    expect(formatValue('relation', ['p1'])).toBe('p1')
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
})
