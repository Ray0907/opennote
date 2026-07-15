import React, { useEffect, useMemo, useRef, useState } from 'react'
import { getShell, type VaultRevision } from '../shell'

export function HistoryDialog({
  open,
  relPath,
  pageTitle,
  onClose,
  onRestore,
}: {
  open: boolean
  relPath: string | null
  pageTitle: string
  onClose: () => void
  onRestore: (content: string) => Promise<void>
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const shell = useMemo(() => getShell(), [])
  const [revisions, setRevisions] = useState<VaultRevision[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [restoring, setRestoring] = useState<string | null>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) {
      dialog.showModal()
      setRevisions(null)
      setError(null)
      if (!relPath || !shell.isDesktop) setRevisions([])
      else {
        void shell.listHistory(relPath).then(setRevisions).catch((reason) => {
          setError(reason instanceof Error ? reason.message : String(reason))
          setRevisions([])
        })
      }
    } else if (!open && dialog.open) dialog.close()
  }, [open, relPath, shell])

  return (
    <dialog ref={ref} className="history-dialog" onClose={onClose} aria-label="Page history">
      <div className="history-header">
        <div><h2>Page history</h2><p>{pageTitle || 'Untitled'}</p></div>
        <button aria-label="Close history" onClick={onClose}>×</button>
      </div>
      {revisions === null ? (
        <p className="history-empty">Loading snapshots…</p>
      ) : error ? (
        <p className="history-empty">History unavailable: {error}</p>
      ) : revisions.length === 0 ? (
        <p className="history-empty">{shell.isDesktop ? 'No snapshots yet. Keep editing and they will appear here.' : 'History is available in the desktop app.'}</p>
      ) : (
        <ol className="history-list">
          {revisions.map((revision) => (
            <li key={revision.hash}>
              <div>
                <strong>{new Date(revision.date).toLocaleString()}</strong>
                <span>{revision.message}</span>
              </div>
              <button
                disabled={restoring !== null}
                onClick={() => {
                  if (!relPath) return
                  setRestoring(revision.hash)
                  void shell.readHistory(relPath, revision.hash).then(async (content) => {
                    if (content !== null) await onRestore(content)
                    setRestoring(null)
                    onClose()
                  }).catch((reason) => {
                    setRestoring(null)
                    setError(reason instanceof Error ? reason.message : String(reason))
                  })
                }}
              >
                {restoring === revision.hash ? 'Restoring…' : 'Restore'}
              </button>
            </li>
          ))}
        </ol>
      )}
    </dialog>
  )
}
