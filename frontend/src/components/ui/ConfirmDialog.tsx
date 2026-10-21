import { useId, useState } from 'react'
import Alert from './Alert'
import Button from './Button'
import { TextField } from './FormField'
import Modal from './Modal'

/**
 * Confirmation dialog for destructive or hard-to-reverse actions.
 *
 * Set `requireText` to make the user type a phrase (for example `DELETE`)
 * before the confirm button becomes available. This is used for permanent,
 * database-wiping actions.
 */
export default function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm',
  danger = false,
  busy = false,
  error = null,
  requireText,
}: {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  message: string
  confirmLabel?: string
  danger?: boolean
  busy?: boolean
  error?: string | null
  requireText?: string
}) {
  const inputId = useId()
  const [typed, setTyped] = useState('')

  // Callers that use `requireText` pass a changing `key` so the component
  // remounts (and this field starts empty) each time the dialog is opened.
  // Ignore case and surrounding whitespace so phone keyboards do not make the
  // confirmation impossible to satisfy; typing the word is still required.
  const confirmed =
    requireText === undefined ||
    typed.trim().toUpperCase() === requireText.trim().toUpperCase()

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <p className="text-sm leading-relaxed text-slate-600">{message}</p>
      {requireText && open && (
        <div className="mt-4">
          <TextField
            id={inputId}
            label={`Type “${requireText}” to confirm`}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            autoFocus
          />
        </div>
      )}
      {error && <Alert className="mt-3">{error}</Alert>}
      <div className="mt-5 flex justify-end gap-2">
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant={danger ? 'danger' : 'primary'}
          onClick={onConfirm}
          loading={busy}
          disabled={!confirmed}
        >
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  )
}
