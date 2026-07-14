import React, { useEffect, useState } from 'react'
import { relativeTime, useSyncStatus } from '../lib/sync-status'

/**
 * Sidebar footer line proving writes reach the server (critique P1).
 * Working Blue appears only while syncing — a genuine "actionable state",
 * so it honors the Working Blue Rule. Offline uses Muted Ink, not a warning
 * color: offline is the normal local-first case, not an error (edits are
 * saved locally regardless).
 */
export function SyncStatusBar() {
  const { phase, lastSyncedAt } = useSyncStatus()
  const [, setTick] = useState(0)

  // Re-render every 20s so "just now" ages into "2m ago" without churn.
  useEffect(() => {
    if (phase !== 'synced') return
    const id = window.setInterval(() => setTick((n) => n + 1), 20_000)
    return () => window.clearInterval(id)
  }, [phase])

  let dotClass = 'sync-dot'
  let label: string
  switch (phase) {
    case 'syncing':
      dotClass += ' syncing'
      label = 'Syncing…'
      break
    case 'offline':
      dotClass += ' offline'
      label = 'Offline — edits saved locally'
      break
    case 'synced':
      dotClass += ' synced'
      label = lastSyncedAt ? `Synced · ${relativeTime(lastSyncedAt)}` : 'Synced'
      break
    default:
      dotClass += ' idle'
      label = 'Local only'
  }

  return (
    <div className="sync-status" role="status" aria-live="polite">
      <span className={dotClass} aria-hidden="true" />
      <span className="sync-status-label">{label}</span>
    </div>
  )
}
