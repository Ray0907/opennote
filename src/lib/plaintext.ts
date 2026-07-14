/**
 * Plain-text extraction from BlockNote blocks, for search matching and
 * result snippets. Pure and dependency-free (same policy as markdown.ts /
 * wikilinks.ts). ILIKE in SQL only coarse-filters on content::text (which
 * also matches JSON keys); this extractor is the precise second pass, so
 * search never false-positives on structural strings like "paragraph".
 */
import type { BNBlock, Inline, InlineText } from './markdown'

function inlineText(content: unknown, out: string[]): void {
  if (!Array.isArray(content)) return
  for (const node of content as Inline[]) {
    if (node.type === 'text') {
      const t = (node as InlineText).text ?? ''
      if (t) out.push(t)
    } else if (node.type === 'link') {
      inlineText((node as { content?: unknown }).content, out)
    }
  }
}

/** Walk blocks (children and table cells included) into one text string. */
export function extractPlainText(blocks: BNBlock[]): string {
  const out: string[] = []
  const walk = (list: BNBlock[]): void => {
    for (const b of list) {
      const c: unknown = b.content
      if (Array.isArray(c)) {
        inlineText(c, out)
      } else if (c && typeof c === 'object' && Array.isArray((c as { rows?: unknown[] }).rows)) {
        for (const row of (c as { rows: { cells?: unknown[] }[] }).rows) {
          for (const cell of row.cells ?? []) inlineText(cell, out)
        }
      }
      if (b.children?.length) walk(b.children)
    }
  }
  walk(blocks)
  return out.join('\n')
}

/** Case-insensitive window around the first match (CJK-safe: pure substring). */
export function makeSnippet(text: string, query: string, radius = 40): string {
  const idx = text.toLowerCase().indexOf(query.toLowerCase())
  if (idx < 0) return text.slice(0, radius * 2)
  const start = Math.max(0, idx - radius)
  const end = Math.min(text.length, idx + query.length + radius)
  return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '')
}
