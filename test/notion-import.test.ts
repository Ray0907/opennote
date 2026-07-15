import { describe, expect, it } from 'vitest'
import { parseCsv, csvToDatabase, classifyImport, stripNotionSuffix } from '../src/lib/notion-import'

let n = 0
const id = () => `id-${++n}`

describe('stripNotionSuffix', () => {
  it('removes the trailing 32-hex id Notion appends', () => {
    expect(stripNotionSuffix('Project Plan 1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d')).toBe('Project Plan')
  })
  it('leaves ordinary names alone', () => {
    expect(stripNotionSuffix('Meeting Notes')).toBe('Meeting Notes')
  })
})

describe('parseCsv (RFC-4180)', () => {
  it('keeps a quoted multi-select cell as one field and honours embedded newlines', () => {
    const csv = 'Name,Tags,Note\nTask,"A, B, C","line1\nline2"\n'
    expect(parseCsv(csv)).toEqual([
      ['Name', 'Tags', 'Note'],
      ['Task', 'A, B, C', 'line1\nline2'],
    ])
  })
  it('unescapes doubled quotes', () => {
    expect(parseCsv('a,"he said ""hi"""')).toEqual([['a', 'he said "hi"']])
  })
})

describe('csvToDatabase', () => {
  it('makes the first column the title and infers a numeric column', () => {
    n = 0
    const db = csvToDatabase('Name,Status,Price\nApple,Done,3\nPear,Todo,5\n', 'Fruit', id)
    expect(db.title).toBe('Fruit')
    expect(db.schema.properties.map((p) => ({ name: p.name, type: p.type }))).toEqual([
      { name: 'Status', type: 'text' },
      { name: 'Price', type: 'number' },
    ])
    const priceId = db.schema.properties[1].id
    expect(db.rows[0]).toEqual({ title: 'Apple', props: { [db.schema.properties[0].id]: 'Done', [priceId]: 3 } })
    expect(db.rows[1].props[priceId]).toBe(5)
  })
  it('always leaves a table view even for an empty file', () => {
    const db = csvToDatabase('', 'Empty', id)
    expect(db.rows).toEqual([])
    expect(db.schema.views).toHaveLength(1)
    expect(db.schema.views[0].kind).toBe('table')
  })
})

describe('classifyImport', () => {
  it('routes .csv to databases and everything else to pages, stripping Notion ids', () => {
    const plan = classifyImport([
      { name: 'Tasks 00112233445566778899aabbccddeeff.csv', content: 'Name,Done\nA,yes\n' },
      { name: 'Welcome deadbeefdeadbeefdeadbeefdeadbeef.md', content: '# Welcome\n\nHi.' },
    ], id)
    expect(plan.databases).toHaveLength(1)
    expect(plan.databases[0].title).toBe('Tasks')
    expect(plan.pages).toHaveLength(1)
    expect(plan.pages[0].title).toBe('Welcome')
  })
})
