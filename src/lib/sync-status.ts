import { useEffect, useState } from 'react'

/**
 * Sync/save status surfaced in the sidebar footer (critique P1: the
 * data-sovereignty audience needs proof-of-write). The sync loop in main.tsx
 * emits these; useSyncStatus() consumes them. Kept as a window CustomEvent so
 * the loop (outside React) and the footer (inside React) stay decoupled.
 */
export type SyncPhase = 'idle' | 'syncing' | 'synced' | 'offline'

export interface SyncStatus {
  phase: SyncPhase
  /** epoch ms of the last successful cycle, for "synced N ago". */
  lastSyncedAt: number | null
}

export const SYNC_STATUS_EVENT = 'opennote:sync-status'

let current: SyncStatus = { phase: 'idle', lastSyncedAt: null }

/** Called by the sync loop. Merges and broadcasts. */
export function emitSyncStatus(patch: Partial<SyncStatus>): void {
  current = { ...current, ...patch }
  window.dispatchEvent(new CustomEvent<SyncStatus>(SYNC_STATUS_EVENT, { detail: current }))
}

export function getSyncStatus(): SyncStatus {
  return current
}

export function useSyncStatus(): SyncStatus {
  const [status, setStatus] = useState<SyncStatus>(getSyncStatus)
  useEffect(() => {
    const onStatus = (e: Event) => setStatus((e as CustomEvent<SyncStatus>).detail)
    window.addEventListener(SYNC_STATUS_EVENT, onStatus)
    return () => window.removeEventListener(SYNC_STATUS_EVENT, onStatus)
  }, [])
  return status
}

/** Compact "just now" / "2m ago" for the footer. */
export function relativeTime(ts: number | null, now: number = Date.now()): string {
  if (ts === null) return ''
  const s = Math.max(0, Math.round((now - ts) / 1000))
  if (s < 5) return 'just now'
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  return `${h}h ago`
}
