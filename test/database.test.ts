import { describe, expect, it } from 'vitest'
import {
  coerceValue,
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
})
