import { describe, expect, it } from 'vitest'
import {
  attachmentPrefixForMirror,
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

  it('renders image and file blocks with mirror-relative attachment paths', () => {
    const md = blocksToMarkdown([
      block('image', [], { props: { url: 'attachments/photo.png', name: 'photo.png', caption: 'Diagram' } }),
      block('file', [], { props: { url: 'attachments/notes.pdf', name: 'notes.pdf' } }),
    ], '../')

    expect(md).toContain('![Diagram](../attachments/photo.png)')
    expect(md).toContain('[notes.pdf](../attachments/notes.pdf)')
  })

  it('renders inline page and linked database references as durable app links', () => {
    const md = blocksToMarkdown([
      block('pageLink', [], { props: { pageId: 'page-1', title: 'Child page' } }),
      block('databaseView', [], { props: { databaseId: 'db-1', title: 'Tasks' } }),
    ])

    expect(md).toContain('[Child page](opennote://page/page-1)')
    expect(md).toContain('[Tasks](opennote://database/db-1)')
  })

  it('renders callouts, toggles, and columns without losing their structure', () => {
    const md = blocksToMarkdown([
      block('callout', [text('Remember this')], { props: { icon: '💡' } }),
      block('toggle', [text('Details')], {
        props: { collapsed: true },
        children: [block('paragraph', [text('Hidden body')])],
      }),
      block('columns', [], {
        props: { columns: 2 },
        children: [
          block('column', [], { children: [block('paragraph', [text('Left')])] }),
          block('column', [], { children: [block('paragraph', [text('Right')])] }),
        ],
      }),
    ])

    expect(md).toContain('> [!NOTE] 💡 Remember this')
    expect(md).toContain('<details>\n<summary>Details</summary>\n\nHidden body\n</details>')
    expect(md).toContain('<div class="opennote-columns" data-columns="2">')
    expect(md).toContain('<section class="opennote-column">\nLeft\n</section>')
    expect(md).toContain('<section class="opennote-column">\nRight\n</section>')
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

  it('computes an attachment prefix from a nested mirror path', () => {
    expect(attachmentPrefixForMirror('Root.md')).toBe('')
    expect(attachmentPrefixForMirror('Parent/Child.md')).toBe('../')
    expect(attachmentPrefixForMirror('A/B/C.md')).toBe('../../')
  })
})
