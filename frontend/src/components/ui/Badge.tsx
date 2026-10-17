import type { ReactNode } from 'react'

type BadgeTone = 'success' | 'muted' | 'info' | 'warning' | 'sky'

const TONE_CLASSES: Record<BadgeTone, string> = {
  success: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  muted: 'bg-slate-100 text-slate-600 ring-slate-200',
  info: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  warning: 'bg-amber-50 text-amber-700 ring-amber-200',
  sky: 'bg-sky-50 text-sky-700 ring-sky-200',
}

export default function Badge({ tone = 'muted', children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONE_CLASSES[tone]}`}
    >
      {children}
    </span>
  )
}
