/**
 * Fractional index keys.
 *
 * A key is a base-62 digit string. `keyBetween(a, b)` returns a key strictly
 * between its neighbors, so reordering a list touches only the moved row.
 * A short random jitter suffix makes offline collisions (two devices
 * inserting into the same gap) vanishingly unlikely (spec F7). Readers must
 * always sort by (sort_key, id) for a stable order regardless.
 */

const DIGITS =
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

/**
 * Classic "string between" midpoint over the DIGITS alphabet.
 * Preconditions: prev < next lexicographically (empty string = unbounded).
 * The result differs from `next` at some position with a smaller digit, so
 * appending any suffix keeps it strictly below `next`; likewise it stays
 * strictly above `prev`.
 */
function midpoint(prev: string, next: string): string {
  let p = 0
  let n = 0
  let pos: number
  // Find the leftmost position where the two keys differ.
  // Sentinels: -1 when prev is exhausted, DIGITS.length when next is.
  for (pos = 0; p === n; pos++) {
    p = pos < prev.length ? DIGITS.indexOf(prev.charAt(pos)) : -1
    n = pos < next.length ? DIGITS.indexOf(next.charAt(pos)) : DIGITS.length
  }
  let str = prev.slice(0, pos - 1) // shared prefix
  if (p === -1) {
    // prev is a prefix of next: copy next's run of smallest digits, then
    // pick a digit below the first non-smallest one.
    while (n === 0) {
      n = pos < next.length ? DIGITS.indexOf(next.charAt(pos++)) : DIGITS.length
      str += DIGITS[0]
    }
    if (n === 1) {
      str += DIGITS[0]
      n = DIGITS.length
    }
  } else if (p + 1 === n) {
    // Adjacent digits: descend into prev, skipping trailing max digits.
    str += DIGITS[p]
    n = DIGITS.length
    while (
      (p = pos < prev.length ? DIGITS.indexOf(prev.charAt(pos++)) : -1) ===
      DIGITS.length - 1
    ) {
      str += DIGITS[DIGITS.length - 1]
    }
  }
  return str + DIGITS[Math.ceil((p + n) / 2)]
}

function jitter(len: number): string {
  let s = ''
  for (let i = 0; i < len; i++) {
    s += DIGITS[Math.floor(Math.random() * DIGITS.length)]
  }
  return s
}

/** Key strictly between a and b. `null` means unbounded on that side. */
export function keyBetween(a: string | null, b: string | null): string {
  const prev = a ?? ''
  const next = b ?? ''
  if (next !== '' && prev >= next) {
    throw new Error(`keyBetween: "${prev}" must sort before "${next}"`)
  }
  return midpoint(prev, next) + jitter(2)
}

/** n keys in ascending order, appended after `after` (or from scratch). */
export function keySequence(n: number, after: string | null = null): string[] {
  const keys: string[] = []
  let prev = after
  for (let i = 0; i < n; i++) {
    const k = keyBetween(prev, null)
    keys.push(k)
    prev = k
  }
  return keys
}
