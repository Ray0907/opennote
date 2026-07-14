/**
 * Wiki-link extraction: finds [[Page Title]] references inside BlockNote
 * inline text. Pure and dependency-free (same policy as markdown.ts) so it
 * is unit-testable and shared by the backlinks index (M4) and the exporter.
 *
 * The links index built from this is DERIVED data: it is always rebuilt
 * locally from block content and is deliberately NOT synced (no outbox
 * trigger, not in SYNC_COLUMNS) so it adds no new conflict surface.
 */
import type { BNBlock, Inline, InlineText } from './markdown'

const WIKI_RE = /\[\[([^\[\]]+?)\]\]/g

/** Extract raw wiki-link targets from one inline-content array. */
function extractFromInline(content: unknown, out: Set<string>): void {
  if (!Array.isArray(content)) return
  for (const node of content as Inline[]) {
    if (node.type === 'text') {
      const text = (node as InlineText).text ?? ''
      for (const m of text.matchAll(WIKI_RE)) {
        const target = m[1].trim()
        if (target) out.add(target)
      }
    } else if (node.type === 'link') {
      extractFromInline((node as { content?: unknown }).content, out)
    }
  }
}

/**
 * Walk a page's blocks (including children and table cells) and return the
 * unique wiki-link titles in first-seen order. Matching is exact on the
 * trimmed title text; case handling is the resolver's concern, not ours.
 */
export function extractWikiLinks(blocks: BNBlock[]): string[] {
  const out = new Set<string>()
  const walk = (list: BNBlock[]): void => {
    for (const b of list) {
      const c: unknown = b.content
      if (Array.isArray(c)) {
        extractFromInline(c, out)
      } else if (c && typeof c === 'object' && Array.isArray((c as { rows?: unknown[] }).rows)) {
        // table content: { type:'tableContent', rows: [{ cells: Inline[][] }] }
        for (const row of (c as { rows: { cells?: unknown[] }[] }).rows) {
          for (const cell of row.cells ?? []) extractFromInline(cell, out)
        }
      }
      if (b.children?.length) walk(b.children)
    }
  }
  walk(blocks)
  return [...out]
}
