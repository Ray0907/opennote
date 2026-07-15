/**
 * Notion-export importer (pure, dependency-free — same policy as markdown.ts).
 *
 * A Notion "Export → Markdown & CSV" produces one `.csv` per database plus
 * `<Title> <32-hex>.md` files for pages (and one per database row). This maps
 * those files onto OpenNote's model: CSV → a database page (schema + child
 * rows), Markdown → an ordinary page. The zip is expanded by the OS file
 * picker; this module only sees the resulting {name, content} files.
 */

import { localId, type DbSchema, type PropertyDef, type PropertyType } from './database'
import { markdownToPage, type ImportedPage } from './markdown'

/** Notion appends a space + 32-char hex id to exported titles and file names. */
export function stripNotionSuffix(name: string): string {
  return name.replace(/\s+[0-9a-f]{32}$/i, '').trim() || name
}

/**
 * RFC-4180 CSV reader: quoted fields, `""` escapes, and commas/newlines inside
 * quotes. Notion joins multi-select values with commas inside one quoted cell,
 * so a naive `split(',')` would corrupt exactly the rows a database is full of.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const s = text.replace(/\r\n?/g, '\n') // normalize CRLF / CR
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++ } // escaped quote
        else quoted = false
      } else field += c
      continue
    }
    if (c === '"') quoted = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else field += c
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row) }
  return rows
}

export interface ParsedDatabase {
  title: string
  schema: DbSchema
  rows: Array<{ title: string; props: Record<string, unknown> }>
}

/**
 * Convert a Notion database CSV export into a database-page model. The first
 * column becomes each row's title; the rest become properties — typed `number`
 * when every non-empty value in the column is a finite number, else `text`
 * (multi-select cells stay verbatim text, since the CSV carries no type info).
 */
export function csvToDatabase(csv: string, title: string, id: () => string = () => localId('imp')): ParsedDatabase {
  const table = parseCsv(csv).filter((r) => r.some((c) => c.trim() !== '')) // drop blank lines
  const table_view = { id: id(), kind: 'table' as const, name: 'Table' }
  if (table.length === 0) return { title, schema: { properties: [], views: [table_view] }, rows: [] }

  const [header, ...body] = table
  const props: PropertyDef[] = header.slice(1).map((name, ci) => {
    const values = body.map((r) => (r[ci + 1] ?? '').trim()).filter((v) => v !== '')
    const type: PropertyType =
      values.length > 0 && values.every((v) => Number.isFinite(Number(v))) ? 'number' : 'text'
    return { id: id(), name: name.trim() || 'Column', type }
  })

  const rows = body.map((r) => {
    const rowProps: Record<string, unknown> = {}
    props.forEach((p, ci) => {
      const raw = (r[ci + 1] ?? '').trim()
      if (raw !== '') rowProps[p.id] = p.type === 'number' ? Number(raw) : raw
    })
    return { title: (r[0] ?? '').trim(), props: rowProps }
  })

  return { title, schema: { properties: props, views: [table_view] }, rows }
}

export interface ImportPlan {
  pages: ImportedPage[]
  databases: ParsedDatabase[]
}

/** Split imported files into pages (.md/.markdown/.txt) and databases (.csv). */
export function classifyImport(
  files: Array<{ name: string; content: string }>,
  id: () => string = () => localId('imp'),
): ImportPlan {
  const plan: ImportPlan = { pages: [], databases: [] }
  for (const file of files) {
    if (/\.csv$/i.test(file.name)) {
      const base = stripNotionSuffix(file.name.replace(/\.csv$/i, '')) || 'Imported database'
      plan.databases.push(csvToDatabase(file.content, base, id))
    } else {
      const base = stripNotionSuffix(file.name.replace(/\.(md|markdown|txt)$/i, '')) || 'Imported page'
      plan.pages.push(markdownToPage(file.content, base))
    }
  }
  return plan
}
