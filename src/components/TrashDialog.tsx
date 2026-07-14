import React, { useEffect, useRef, useState } from 'react'
import type { PGlite } from '@electric-sql/pglite'
import type { Page } from '../db/repo'
import * as repo from '../db/repo'

/**
 * Trash browser (critique P0: trash existed in the data layer with no UI
 * entry). Lists soft-deleted root pages and restores their whole subtree.
 * Uses the native <dialog> element for a real focus trap + Escape dismiss.
 */
export function TrashDialog({
  db,
  open,
  onClose,
  onRestored,
}: {
  db: PGlite
  open: boolean
  onClose: () => void
  onRestored: (id: string) => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const [rows, setRows] = useState<Page[] | null>(null)

  useEffect(() => {
    const dlg = ref.current
    if (!dlg) return
    if (open && !dlg.open) {
      dlg.showModal()
      setRows(null)
      void repo.listTrash(db).then(setRows)
    } else if (!open && dlg.open) {
      dlg.close()
    }
  }, [open, db])

  const restore = async (id: string) => {
    await repo.restorePage(db, id)
    onRestored(id)
    setRows(await repo.listTrash(db))
  }

  return (
    <dialog ref={ref} className="trash-dialog" onClose={onClose} aria-label="Trash">
      <div className="trash-header">
        <h2>Trash</h2>
        <button className="trash-close" aria-label="Close trash" onClick={onClose}>
          ×
        </button>
      </div>
      {rows === null ? (
        <p className="trash-empty">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="trash-empty">Trash is empty. Deleted pages appear here.</p>
      ) : (
        <ul className="trash-list">
          {rows.map((p) => (
            <li key={p.id} className="trash-row">
              <span className="trash-title">
                {p.icon ? `${p.icon} ` : ''}
                {p.title || 'Untitled'}
              </span>
              <button className="trash-restore" onClick={() => void restore(p.id)}>
                Restore
              </button>
            </li>
          ))}
        </ul>
      )}
    </dialog>
  )
}
