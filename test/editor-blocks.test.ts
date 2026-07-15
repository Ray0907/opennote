import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import * as editorPane from '../src/components/EditorPane'

const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  overrides?: Record<string, string>
}

const createBlock = (editorPane as unknown as {
  createCustomBlock?: (kind: 'callout' | 'toggle' | 'columns') => Record<string, unknown>
}).createCustomBlock

describe('custom editor block defaults', () => {
  it('pins the TipTap lifecycle used by BlockNote 0.17 custom blocks', () => {
    expect(manifest.overrides).toMatchObject({
      '@tiptap/core': '2.7.1',
      '@tiptap/pm': '2.7.1',
      '@tiptap/react': '2.7.1',
      'prosemirror-view': '1.33.10',
    })
  })

  it('targets BlockNote custom-block descendants without assuming wrapper depth', () => {
    expect(styles).toContain(".bn-block-outer:has(.toggle-block[data-collapsed='true']) > .bn-block > .bn-block-group")
    expect(styles).toContain('.bn-block-outer:has(.columns-block) > .bn-block > .bn-block-group')
    expect(styles).toContain('.bn-block-outer:has(.column-block)')
  })

  it('creates callout text as inline content', () => {
    expect(createBlock).toBeTypeOf('function')
    expect(createBlock?.('callout')).toMatchObject({
      type: 'callout',
      content: [{ type: 'text', text: 'Callout', styles: {} }],
    })
  })

  it('creates toggle summary and body text as inline content', () => {
    expect(createBlock?.('toggle')).toMatchObject({
      type: 'toggle',
      content: [{ type: 'text', text: 'Toggle', styles: {} }],
      children: [{
        type: 'paragraph',
        content: [{ type: 'text', text: 'Toggle details', styles: {} }],
      }],
    })
  })

  it('creates visible text in both columns', () => {
    expect(createBlock?.('columns')).toMatchObject({
      type: 'columns',
      children: [
        { children: [{ content: [{ type: 'text', text: 'Left column', styles: {} }] }] },
        { children: [{ content: [{ type: 'text', text: 'Right column', styles: {} }] }] },
      ],
    })
  })
})
