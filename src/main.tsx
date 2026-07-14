import React from 'react'
import { createRoot } from 'react-dom/client'
import type { PGlite } from '@electric-sql/pglite'
import { createDb } from './db/db'
import { initClientSync, syncOnce } from './sync/client'
import { createHttpTransport } from './sync/http'
import { emitSyncStatus } from './lib/sync-status'
import { App } from './App'
import './styles.css'

/** Fired whenever a sync cycle applied remote changes; App refreshes on it. */
export const REMOTE_CHANGE_EVENT = 'opennote:remote-change'

const SYNC_INTERVAL_MS = 3_000

/**
 * Sync server base URL. Overridable per machine via localStorage (an
 * explicit user setting lands with M3's settings UI), else the default
 * local server started by `npm run sync-server`.
 */
function syncBaseUrl(): string {
  return (
    window.localStorage.getItem('opennote.sync_url') ??
    import.meta.env.VITE_SYNC_URL ??
    'http://127.0.0.1:8787'
  )
}

/**
 * Offline-first sync loop: one push/pull cycle per tick, never overlapping.
 * A down server is the normal offline case — log once, keep ticking; the
 * outbox holds every local write until a cycle succeeds (spec F3).
 */
function startSyncLoop(db: PGlite): void {
  const transport = createHttpTransport(syncBaseUrl())
  let inFlight = false
  let wasOffline = false
  const tick = async (): Promise<void> => {
    if (inFlight) return
    inFlight = true
    // Only show the "syncing" pulse when there are local writes to push —
    // an idle online poll must not blink Working Blue every interval while
    // the user is typing (Working Blue Rule + no-motion-while-typing).
    let pending = 0
    try {
      const { rows } = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM outbox')
      pending = rows[0]?.n ?? 0
    } catch {
      // Outbox unreadable — treat as idle; the sync attempt still runs.
    }
    if (pending > 0) emitSyncStatus({ phase: 'syncing' })
    try {
      const result = await syncOnce(db, transport)
      if (wasOffline) console.info('sync: back online')
      wasOffline = false
      emitSyncStatus({ phase: 'synced', lastSyncedAt: Date.now() })
      if (result.applied > 0) {
        window.dispatchEvent(new Event(REMOTE_CHANGE_EVENT))
      }
    } catch (err) {
      if (!wasOffline) console.info('sync: offline (queuing locally)', err)
      wasOffline = true
      emitSyncStatus({ phase: 'offline' })
    } finally {
      inFlight = false
    }
  }
  void tick()
  window.setInterval(() => void tick(), SYNC_INTERVAL_MS)
}

const root = createRoot(document.getElementById('root')!)
root.render(<div className="boot">Opening your workspace…</div>)

// Persistent IndexedDB store in the desktop app / browser; the DB is a
// rebuildable cache — durability comes from the Markdown mirror (spec F5)
// and, from M2 on, the sync server.
createDb('idb://opennote')
  .then(async (db) => {
    // First launch persists this id (ON CONFLICT DO NOTHING); later launches
    // keep the stored one. Must run before any user write so the outbox
    // trigger captures everything.
    await initClientSync(db, crypto.randomUUID())
    startSyncLoop(db)
    root.render(<App db={db} />)
  })
  .catch((err: unknown) => {
    console.error('Failed to open the local database', err)
    root.render(
      <div className="boot boot-error">
        Failed to open the local database: {String(err)}
      </div>,
    )
  })
