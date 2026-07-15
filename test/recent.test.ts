import { describe, expect, it } from 'vitest'
import { getRecent, recordRecent } from '../src/lib/recent'

function fakeStore() {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  }
}

describe('recent pages', () => {
  it('returns [] on a fresh or corrupt store', () => {
    const s = fakeStore()
    expect(getRecent(s)).toEqual([])
    s.setItem('opennote:recent-pages', 'not json')
    expect(getRecent(s)).toEqual([])
  })

  it('puts the newest first and dedupes', () => {
    const s = fakeStore()
    recordRecent('a', s)
    recordRecent('b', s)
    recordRecent('a', s) // re-open a
    expect(getRecent(s)).toEqual(['a', 'b'])
  })

  it('caps at 8 entries', () => {
    const s = fakeStore()
    for (let i = 0; i < 12; i++) recordRecent(`p${i}`, s)
    const list = getRecent(s)
    expect(list).toHaveLength(8)
    expect(list[0]).toBe('p11')
    expect(list).not.toContain('p3')
  })
})
