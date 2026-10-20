import type { ReactNode } from 'react'

/** Friendly empty-state block for lists and tables with no rows yet. */
export default function EmptyState({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
      <span
        aria-hidden="true"
        className="mx-auto mb-3 grid size-10 place-items-center rounded-full bg-slate-100 text-slate-500 ring-1 ring-slate-200"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="size-5"
        >
          <path d="M7 3.75h7.5L19.5 8.7v11.55H7a2.25 2.25 0 0 1-2.25-2.25V6A2.25 2.25 0 0 1 7 3.75Z" />
          <path d="M14.25 3.75V9h5.25M9 13.5h6M9 17.25h4.5" />
        </svg>
      </span>
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {description && <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  )
}
