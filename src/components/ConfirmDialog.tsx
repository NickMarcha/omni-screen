import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'

export interface ConfirmDialogProps {
  open: boolean
  title: string
  message: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** DaisyUI button variant for confirm (e.g. 'btn-error' for destructive). Default 'btn-primary'. */
  confirmVariant?: string
  onConfirm: () => void
  onCancel: () => void
}

/** Reusable confirmation dialog using DaisyUI modal. Replaces window.confirm for themed UX. */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  confirmVariant = 'btn-primary',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!open) return null

  const handleConfirm = () => {
    onConfirm()
  }

  const handleCancel = () => {
    onCancel()
  }

  return createPortal(
    <div className="modal modal-open z-[110]" role="dialog" aria-modal="true" aria-labelledby="confirm-dialog-title">
      <div className="modal-box max-w-md">
        <h3 id="confirm-dialog-title" className="font-bold text-lg">
          {title}
        </h3>
        <p className="py-4 text-base-content/80">{message}</p>
        <div className="modal-action">
          <button type="button" className="btn btn-ghost" onClick={handleCancel}>
            {cancelLabel}
          </button>
          <button type="button" className={`btn ${confirmVariant}`} onClick={handleConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
      <div className="modal-backdrop" onClick={handleCancel} aria-hidden="true" />
    </div>,
    document.body
  )
}
