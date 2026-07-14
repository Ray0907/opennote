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

  it('parses standalone Markdown images as image blocks', () => {
    const [image] = markdownToBlocks('![A diagram](../attachments/diagram.png)', nextId)
    expect(image.type).toBe('image')
    expect(image.props).toEqual({
      url: 'attachments/diagram.png',
      name: 'A diagram',
      caption: 'A diagram',
    })
    expect(image.content).toEqual([])
  })

  it('restores nested vault attachments and file blocks to canonical URLs', () => {
    const blocks = markdownToBlocks(
      '![Diagram](../../attachments/diagram.png)\n\n[Report](../../attachments/report.pdf)<!-- opennote:file -->',
      nextId,
    )

    expect(blocks.map((block) => ({ type: block.type, props: block.props }))).toEqual([
      {
        type: 'image',
        props: { url: 'attachments/diagram.png', name: 'Diagram', caption: 'Diagram' },
      },
      {
        type: 'file',
        props: { url: 'attachments/report.pdf', name: 'Report' },
      },
    ])
  })

  it('parses durable app links back into reference blocks', () => {
    const blocks = markdownToBlocks(
      '[Child page](opennote://page/page-1)\n\n[Tasks](opennote://database/db-1)',
      nextId,
    )
    expect(blocks.map((block) => ({ type: block.type, props: block.props }))).toEqual([
      { type: 'pageLink', props: { pageId: 'page-1', title: 'Child page' } },
      { type: 'databaseView', props: { databaseId: 'db-1', title: 'Tasks' } },
    ])
  })

  it('reconstructs callout, toggle, and column block hierarchy', () => {
    const md = [
      '> [!NOTE] 💡 Remember this',
      '',
      '<details open>',
      '<summary>Details</summary>',
      '',
      'Hidden body',
      '</details>',
      '',
      '<div class="opennote-columns" data-columns="2">',
      '<section class="opennote-column">',
      'Left',
      '</section>',
      '<section class="opennote-column">',
      'Right',
      '</section>',
      '</div>',
    ].join('\n')
    const blocks = markdownToBlocks(md, nextId)

    expect(blocks[0]).toMatchObject({ type: 'callout', props: { icon: '💡' } })
    expect(blocks[1]).toMatchObject({ type: 'toggle', props: { collapsed: false } })
    expect(blocks[1].children?.[0].type).toBe('paragraph')
    expect(blocks[2]).toMatchObject({ type: 'columns', props: { columns: 2 } })
    expect(blocks[2].children?.map((column) => column.type)).toEqual(['column', 'column'])
    expect(blocks[2].children?.map((column) => column.children?.[0].content)).toEqual([
      [{ type: 'text', text: 'Left' }],
      [{ type: 'text', text: 'Right' }],
    ])
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
