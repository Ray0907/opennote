import { describe, expect, it } from 'vitest'
import { TEMPLATES, getTemplate } from '../src/lib/templates'
import type { BNBlock } from '../src/lib/markdown'

function collectIds(blocks: BNBlock[], out: string[] = []): string[] {
  for (const b of blocks) {
    out.push(b.id)
    collectIds(b.children ?? [], out)
  }
  return out
}

describe('templates', () => {
  it('exposes at least three templates with unique ids', () => {
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(3)
    const ids = TEMPLATES.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('getTemplate resolves by id and returns null for unknown', () => {
    for (const t of TEMPLATES) expect(getTemplate(t.id)).toBe(t)
    expect(getTemplate('nope')).toBeNull()
  })

  it('build() produces non-empty blocks with valid shape', () => {
    for (const t of TEMPLATES) {
      const blocks = t.build()
      expect(blocks.length).toBeGreaterThan(0)
      for (const b of blocks) {
        expect(typeof b.id).toBe('string')
        expect(b.id.length).toBeGreaterThan(0)
        expect(typeof b.type).toBe('string')
        expect(Array.isArray(b.content)).toBe(true)
      }
    }
  })

  it('build() mints fresh block ids on every call', () => {
    for (const t of TEMPLATES) {
      const a = collectIds(t.build())
      const b = collectIds(t.build())
      expect(new Set([...a, ...b]).size).toBe(a.length + b.length)
    }
  })
})
