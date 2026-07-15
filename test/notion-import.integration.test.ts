import { beforeEach, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb } from '../src/db/db'
import * as repo from '../src/db/repo'
import { classifyImport } from '../src/lib/notion-import'
import { applyView, normalizeSchema } from '../src/lib/database'

/**
 * Exercises the CSV importer through the real repo (createPage / setDbSchema /
 * setPageProps) the way App.handleImport wires it — a unit test on the pure
 * parser can't catch a persistence or render-path wiring bug.
 */
describe('Notion CSV import → repo (end-to-end)', () => {
  let db: PGlite
  beforeEach(async () => {
    db = await createDb()
  })

  it('persists a database page with typed rows that render through a view', async () => {
    const csv = 'Name,Status,Price\nApple,"Done, shipped",3\nPear,Todo,5\n'
    const { databases } = classifyImport([
      { name: 'Fruit 00112233445566778899aabbccddeeff.csv', content: csv },
    ])
    expect(databases).toHaveLength(1)
    const parsed = databases[0]

    // Replay handleImport's database branch.
    const dbPage = await repo.createPage(db, { parentId: null, title: parsed.title, isDatabase: true })
    await repo.setDbSchema(db, dbPage.id, parsed.schema)
    for (const row of parsed.rows) {
      const rowPage = await repo.createPage(db, { parentId: dbPage.id, title: row.title })
      if (Object.keys(row.props).length > 0) await repo.setPageProps(db, rowPage.id, row.props)
    }

    // The database page persists as a database.
    const saved = await repo.getPage(db, dbPage.id)
    expect(saved?.is_database).toBe(true)
    expect(saved?.title).toBe('Fruit')

    // Its schema survives the render path (DatabaseView calls normalizeSchema).
    const schema = normalizeSchema(saved?.db_schema)
    expect(schema.properties.map((p) => p.type)).toEqual(['text', 'number'])
    expect(schema.views[0].kind).toBe('table')

    // Rows are children carrying typed props; the quoted comma stayed one value.
    const pages = await repo.listPages(db)
    const rows = pages.filter((p) => p.parent_id === dbPage.id)
    expect(rows.map((r) => r.title).sort()).toEqual(['Apple', 'Pear'])
    const priceId = schema.properties[1].id
    const apple = rows.find((r) => r.title === 'Apple')!
    expect(apple.props?.[schema.properties[0].id]).toBe('Done, shipped')
    expect(apple.props?.[priceId]).toBe(3)

    // A sort view over the imported rows doesn't throw and orders by the number.
    const viewRows = rows.map((r) => ({ title: r.title, props: r.props }))
    const sorted = applyView(viewRows, { id: 'v', kind: 'table', name: 'T', sortBy: priceId, sortDir: 'desc' }, schema)
    expect(sorted.map((r) => r.title)).toEqual(['Pear', 'Apple'])
  })
})
