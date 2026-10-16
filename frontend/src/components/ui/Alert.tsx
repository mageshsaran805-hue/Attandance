import type { ReactNode } from 'react'

type AlertTone = 'error' | 'success' | 'info'

const TONE_CLASSES: Record<AlertTone, string> = {
  error: 'border-rose-200 bg-rose-50 text-rose-800',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  info: 'border-sky-200 bg-sky-50 text-sky-800',
}

/**
 * Inline feedback message. Errors use role="alert" so screen readers announce
 * them; success and info use role="status".
 */
export default function Alert({
  tone = 'error',
  children,
  className = '',
}: {
  tone?: AlertTone
  children: ReactNode
  className?: string
}) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`rounded-lg border px-3 py-2 text-sm ${TONE_CLASSES[tone]} ${className}`}
    >
      {children}
    </div>
  )
}
