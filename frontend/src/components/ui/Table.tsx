import type { ReactNode } from 'react'

/** Consistent table chrome: horizontal scroll and borders on small screens. */
export function Table({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <table aria-label={label} className="w-full min-w-[36rem] text-left text-sm">
        {children}
      </table>
    </div>
  )
}

export function Th({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return (
    <th
      scope="col"
      className={`whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 ${className}`}
    >
      {children}
    </th>
  )
}

export function Td({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return <td className={`border-t border-slate-100 px-4 py-3 align-middle ${className}`}>{children}</td>
}
