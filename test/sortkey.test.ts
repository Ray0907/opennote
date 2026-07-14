import { describe, expect, it } from 'vitest'
import { keyBetween, keySequence } from '../src/lib/sortkey'

describe('keyBetween', () => {
  it('generates a key with no neighbors', () => {
    const key = keyBetween(null, null)
    expect(key.length).toBeGreaterThan(0)
  })

  it('orders append sequences', () => {
    const keys = keySequence(200)
    for (let i = 1; i < keys.length; i++) {
      expect(keys[i - 1] < keys[i]).toBe(true)
    }
  })

  it('rejects inverted neighbors', () => {
    expect(() => keyBetween('b', 'a')).toThrow()
    expect(() => keyBetween('a', 'a')).toThrow()
  })

  it('stays ordered and unique under 2000 random insertions', () => {
    const keys: string[] = [keyBetween(null, null)]
    for (let i = 0; i < 2000; i++) {
      // Random gap, including both unbounded ends.
      const pos = Math.floor(Math.random() * (keys.length + 1))
      const prev = pos > 0 ? keys[pos - 1] : null
      const next = pos < keys.length ? keys[pos] : null
      const key = keyBetween(prev, next)
      keys.splice(pos, 0, key)
    }
    for (let i = 1; i < keys.length; i++) {
      expect(keys[i - 1] < keys[i]).toBe(true)
    }
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('survives repeated head insertions (leading-zero paths)', () => {
    let head = keyBetween(null, null)
    for (let i = 0; i < 500; i++) {
      const smaller = keyBetween(null, head)
      expect(smaller < head).toBe(true)
      head = smaller
    }
  })

  it('survives repeated narrow-gap insertions', () => {
    let lo = keyBetween(null, null)
    let hi = keyBetween(lo, null)
    for (let i = 0; i < 500; i++) {
      const mid = keyBetween(lo, hi)
      expect(lo < mid && mid < hi).toBe(true)
      if (i % 2 === 0) lo = mid
      else hi = mid
    }
  })
})
