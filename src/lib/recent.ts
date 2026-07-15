/**
 * Recently-opened pages for the ⌘K palette (pure, storage-injectable so it is
 * testable without a DOM). Most-recent first, deduped, capped. This is a
 * per-device convenience only — never synced, never a source of truth.
 */

const KEY = 'opennote:recent-pages'
const MAX = 8

type Store = Pick<Storage, 'getItem' | 'setItem'>

export function getRecent(store: Store = localStorage): string[] {
  try {
    const parsed: unknown = JSON.parse(store.getItem(KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

/** Push `id` to the front, drop any earlier copy, cap the list. Returns the new list. */
export function recordRecent(id: string, store: Store = localStorage): string[] {
  const next = [id, ...getRecent(store).filter((x) => x !== id)].slice(0, MAX)
  store.setItem(KEY, JSON.stringify(next))
  return next
}
