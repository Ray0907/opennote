import React, { useEffect } from 'react'

export interface ToastState {
  message: string
  actionLabel?: string
  onAction?: () => void
}

/**
 * Single non-modal toast (critique P0: delete needs an undo path). Auto-
 * dismisses after `duration`; the action (Undo) is keyboard-reachable. Not a
 * modal — writing is never blocked (Principle 4).
 */
export function Toast({
  toast,
  onDismiss,
  duration = 6000,
}: {
  toast: ToastState | null
  onDismiss: () => void
  duration?: number
}) {
  useEffect(() => {
    if (!toast) return
    const id = window.setTimeout(onDismiss, duration)
    return () => window.clearTimeout(id)
  }, [toast, duration, onDismiss])

  if (!toast) return null

  return (
    <div className="toast" role="status" aria-live="polite">
      <span className="toast-message">{toast.message}</span>
      {toast.actionLabel && toast.onAction && (
        <button
          className="toast-action"
          onClick={() => {
            toast.onAction!()
            onDismiss()
          }}
        >
          {toast.actionLabel}
        </button>
      )}
      <button className="toast-close" aria-label="Dismiss" onClick={onDismiss}>
        ×
      </button>
    </div>
  )
}
