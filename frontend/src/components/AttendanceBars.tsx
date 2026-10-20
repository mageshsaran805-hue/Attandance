import { formatPercent } from '../lib/format'

export interface AttendanceBarItem {
  key: string
  label: string
  sublabel?: string
  detail?: string
  /** Backend-rounded percentage, or null when the range has no settled marks. */
  percentage: number | null
}

function barTone(percentage: number | null): string {
  if (percentage === null) {
    return 'bg-slate-300'
  }
  if (percentage >= 75) {
    return 'bg-emerald-500'
  }
  if (percentage >= 50) {
    return 'bg-amber-500'
  }
  return 'bg-rose-500'
}

/**
 * Dependency-free horizontal bar list for department/class attendance.
 * Percentages are already computed by the reporting API.
 */
export default function AttendanceBars({
  title,
  description,
  items,
  emptyMessage = 'No settled attendance in this range yet.',
}: {
  title: string
  description?: string
  items: AttendanceBarItem[]
  emptyMessage?: string
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
          {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
        </div>
        <div className="flex items-center gap-3 text-[11px] text-slate-500" aria-hidden="true">
          <span className="flex items-center gap-1">
            <span className="size-2 rounded-full bg-emerald-500" /> 75%+
          </span>
          <span className="flex items-center gap-1">
            <span className="size-2 rounded-full bg-amber-500" /> 50–74%
          </span>
          <span className="flex items-center gap-1">
            <span className="size-2 rounded-full bg-rose-500" /> below 50%
          </span>
        </div>
      </div>

      {items.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">{emptyMessage}</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {items.map((item) => {
            const value = item.percentage ?? 0
            return (
              <li key={item.key}>
                <div className="flex items-baseline justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-800">{item.label}</p>
                    {item.sublabel && (
                      <p className="truncate text-xs text-slate-500">{item.sublabel}</p>
                    )}
                  </div>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-700">
                    {formatPercent(item.percentage)}
                  </span>
                </div>
                <div
                  className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100"
                  role="img"
                  aria-label={`${item.label}: ${formatPercent(item.percentage)}`}
                >
                  <div
                    className={`h-full rounded-full ${barTone(item.percentage)}`}
                    style={{ width: `${value}%` }}
                  />
                </div>
                {item.detail && <p className="mt-1 text-xs text-slate-500">{item.detail}</p>}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
