import { describe, expect, it } from 'vitest'
import {
  blocksToMarkdown,
  markdownToBlocks,
  markdownToPage,
  parseInline,
  type BNBlock,
} from '../src/lib/markdown'

let n = 0
const nextId = () => `id-${++n}`

function strip(blocks: BNBlock[]): unknown[] {
  return blocks.map((b) => ({
    type: b.type,
    props: b.props ?? {},
    content: b.content,
    children: strip(b.children ?? []),
  }))
}

describe('parseInline', () => {
  it('parses plain text', () => {
    expect(parseInline('hello')).toEqual([{ type: 'text', text: 'hello' }])
  })

  it('parses bold, italic, code, strike', () => {
    expect(parseInline('**b** *i* `c` ~~s~~')).toEqual([
      { type: 'text', text: 'b', styles: { bold: true } },
      { type: 'text', text: ' ' },
      { type: 'text', text: 'i', styles: { italic: true } },
      { type: 'text', text: ' ' },
      { type: 'text', text: 'c', styles: { code: true } },
      { type: 'text', text: ' ' },
      { type: 'text', text: 's', styles: { strike: true } },
    ])
  })

  it('parses nested styles', () => {
    expect(parseInline('**bold *both***')).toEqual([
      { type: 'text', text: 'bold ', styles: { bold: true } },
      { type: 'text', text: 'both', styles: { italic: true, bold: true } },
    ])
  })

  it('parses links', () => {
    expect(parseInline('see [docs](https://example.com) ok')).toEqual([
      { type: 'text', text: 'see ' },
      { type: 'link', href: 'https://example.com', content: [{ type: 'text', text: 'docs' }] },
      { type: 'text', text: ' ok' },
    ])
  })

  it('leaves unbalanced markers as literal text', () => {
    expect(parseInline('a ** b')).toEqual([{ type: 'text', text: 'a ** b' }])
  })
})

describe('markdownToBlocks', () => {
  it('parses headings, paragraphs, quotes', () => {
    const md = '# Title\n\nBody text.\n\n> quoted\n'
    expect(strip(markdownToBlocks(md, nextId))).toEqual([
      { type: 'heading', props: { level: 1 }, content: [{ type: 'text', text: 'Title' }], children: [] },
      { type: 'paragraph', props: {}, content: [{ type: 'text', text: 'Body text.' }], children: [] },
      { type: 'quote', props: {}, content: [{ type: 'text', text: 'quoted' }], children: [] },
    ])
  })

  it('parses nested lists and checkboxes', () => {
    const md = '- a\n  - a1\n- [x] done\n1. first\n'
    const blocks = markdownToBlocks(md, nextId)
    expect(blocks).toHaveLength(3)
    expect(blocks[0].type).toBe('bulletListItem')
    expect(blocks[0].children![0].type).toBe('bulletListItem')
    expect(blocks[1].type).toBe('checkListItem')
    expect(blocks[1].props).toEqual({ checked: true })
    expect(blocks[2].type).toBe('numberedListItem')
  })

  it('parses fenced code blocks verbatim', () => {
    const md = '```ts\nconst x = 1\n\nif (x) {}\n```\n'
    const blocks = markdownToBlocks(md, nextId)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('codeBlock')
    expect(blocks[0].props).toEqual({ language: 'ts' })
    expect(blocks[0].content).toEqual([{ type: 'text', text: 'const x = 1\n\nif (x) {}' }])
  })

  it('round-trips serializer output', () => {
    const original: BNBlock[] = [
      { id: 'h', type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: 'Notes' }], children: [] },
      {
        id: 'l1',
        type: 'bulletListItem',
        props: {},
        content: [{ type: 'text', text: 'top', styles: { bold: true } }],
        children: [
          { id: 'l2', type: 'checkListItem', props: { checked: false }, content: [{ type: 'text', text: 'sub' }], children: [] },
        ],
      },
      { id: 'p', type: 'paragraph', props: {}, content: [{ type: 'text', text: 'end' }], children: [] },
    ]
    const md = blocksToMarkdown(original)
    const reparsed = markdownToBlocks(md, nextId)
    expect(blocksToMarkdown(reparsed)).toBe(md)
  })
})

describe('markdownToPage', () => {
  it('reads the title from frontmatter and never trusts imported ids', () => {
    const md = '---\nid: 11111111-1111-4111-8111-111111111111\ntitle: "My \\"Page\\""\n---\n\nhello\n'
    const page = markdownToPage(md, 'fallback', nextId)
    expect(page.title).toBe('My "Page"')
    expect(page.blocks).toHaveLength(1)
    expect(page.blocks[0].id).toMatch(/^id-\d+$/)
  })

  it('falls back to the first heading, then the default', () => {
    expect(markdownToPage('# From Heading\n\nx\n', 'fb', nextId).title).toBe('From Heading')
    expect(markdownToPage('just text\n', 'fb', nextId).title).toBe('fb')
  })
})
