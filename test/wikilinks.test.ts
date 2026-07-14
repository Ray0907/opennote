import { describe, expect, it } from 'vitest'
import { extractWikiLinks } from '../src/lib/wikilinks'
import type { BNBlock } from '../src/lib/markdown'

function para(id: string, text: string): BNBlock {
  return { id, type: 'paragraph', content: [{ type: 'text', text, styles: {} }] }
}

describe('wiki-link extraction', () => {
  it('finds [[Title]] targets in paragraph text', () => {
    const blocks = [para('1', 'see [[Roadmap]] and [[Meeting Notes]] today')]
    expect(extractWikiLinks(blocks)).toEqual(['Roadmap', 'Meeting Notes'])
  })

  it('dedupes repeated targets and preserves first-seen order', () => {
    const blocks = [para('1', '[[B]] then [[A]]'), para('2', '[[A]] again [[B]]')]
    expect(extractWikiLinks(blocks)).toEqual(['B', 'A'])
  })

  it('trims whitespace and skips empty/unclosed brackets', () => {
    const blocks = [para('1', '[[  Padded  ]] [[]] [[unclosed and [[Real]]')]
    expect(extractWikiLinks(blocks)).toEqual(['Padded', 'Real'])
  })

  it('walks nested children blocks', () => {
    const blocks: BNBlock[] = [
      {
        id: '1',
        type: 'bulletListItem',
        content: [{ type: 'text', text: 'top [[Outer]]', styles: {} }],
        children: [para('2', 'nested [[Inner]]')],
      },
    ]
    expect(extractWikiLinks(blocks)).toEqual(['Outer', 'Inner'])
  })

  it('reads table cells', () => {
    const blocks: BNBlock[] = [
      {
        id: 't',
        type: 'table',
        content: {
          type: 'tableContent',
          rows: [{ cells: [[{ type: 'text', text: 'cell [[FromTable]]', styles: {} }], []] }],
        },
      },
    ]
    expect(extractWikiLinks(blocks)).toEqual(['FromTable'])
  })

  it('reads text nested inside external links', () => {
    const blocks: BNBlock[] = [
      {
        id: '1',
        type: 'paragraph',
        content: [
          {
            type: 'link',
            href: 'https://example.com',
            content: [{ type: 'text', text: 'anchor [[LinkedFromAnchor]]', styles: {} }],
          },
        ],
      },
    ]
    expect(extractWikiLinks(blocks)).toEqual(['LinkedFromAnchor'])
  })

  it('returns empty for blocks without matches', () => {
    expect(extractWikiLinks([para('1', 'plain text, [single] brackets')])).toEqual([])
  })
})
