import { describe, expect, it } from 'vitest'
import {
  blocksToMarkdown,
  pageToMarkdown,
  sanitizeFileName,
  serializeInline,
  type BNBlock,
} from '../src/lib/markdown'

function text(t: string, styles?: Record<string, unknown>) {
  return { type: 'text' as const, text: t, styles }
}

function block(type: string, content: unknown, extra: Partial<BNBlock> = {}): BNBlock {
  return { id: crypto.randomUUID(), type, content, ...extra }
}

describe('serializeInline', () => {
  it('renders styles', () => {
    expect(
      serializeInline([
        text('plain '),
        text('bold', { bold: true }),
        text(' and '),
        text('code', { code: true }),
      ]),
    ).toBe('plain **bold** and `code`')
  })

  it('renders links', () => {
    expect(
      serializeInline([{ type: 'link', href: 'https://example.com', content: [text('site')] }]),
    ).toBe('[site](https://example.com)')
  })
})

describe('blocksToMarkdown', () => {
  it('renders headings, lists, checklists, quotes and code', () => {
    const md = blocksToMarkdown([
      block('heading', [text('Title')], { props: { level: 2 } }),
      block('paragraph', [text('Hello world')]),
      block('bulletListItem', [text('item one')]),
      block('numberedListItem', [text('first')]),
      block('numberedListItem', [text('second')]),
      block('checkListItem', [text('done')], { props: { checked: true } }),
      block('quote', [text('wise words')]),
      block('codeBlock', [text('const x = 1')], { props: { language: 'ts' } }),
    ])
    expect(md).toContain('## Title')
    expect(md).toContain('Hello world')
    expect(md).toContain('- item one')
    expect(md).toContain('1. first')
    expect(md).toContain('2. second')
    expect(md).toContain('- [x] done')
    expect(md).toContain('> wise words')
    expect(md).toContain('```ts\nconst x = 1\n```')
  })

  it('indents nested children', () => {
    const md = blocksToMarkdown([
      block('bulletListItem', [text('parent')], {
        children: [block('bulletListItem', [text('child')])],
      }),
    ])
    expect(md).toContain('- parent\n  - child')
  })

  it('handles CJK text untouched', () => {
    const md = blocksToMarkdown([block('paragraph', [text('會議記錄')])])
    expect(md).toContain('會議記錄')
  })
})

describe('pageToMarkdown', () => {
  it('emits frontmatter with id and escaped title', () => {
    const md = pageToMarkdown(
      { id: 'abc-123', title: 'My "quoted" page' },
      [block('paragraph', [text('body')])],
    )
    expect(md.startsWith('---\n')).toBe(true)
    expect(md).toContain('id: abc-123')
    expect(md).toContain('title: "My \\"quoted\\" page"')
    expect(md).toContain('body')
  })
})

describe('sanitizeFileName', () => {
  it('strips path-hostile characters', () => {
    expect(sanitizeFileName('a/b\\c:d*e?"f"')).not.toMatch(/[/\\:*?"]/)
  })
  it('falls back for empty titles', () => {
    expect(sanitizeFileName('   ')).toBe('Untitled')
  })
  it('keeps CJK titles', () => {
    expect(sanitizeFileName('會議記錄')).toBe('會議記錄')
  })
})
