function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-md bg-slate-200/80 ${className}`} />
}

const GRID_CLASSES: Record<number, string> = {
  2: 'grid-cols-1 sm:grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-3',
  4: 'grid-cols-2 lg:grid-cols-4',
  5: 'grid-cols-2 lg:grid-cols-5',
}

/**
 * Lightweight loading placeholder for data-driven pages. It keeps the layout
 * stable while the first request is in flight and announces progress to
 * screen readers without repeating the visual shimmer.
 */
export default function LoadingSkeleton({
  label = 'Loading…',
  cards = 4,
  rows = 3,
}: {
  label?: string
  cards?: 2 | 3 | 4 | 5
  rows?: number
}) {
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="space-y-4">
        <div className={`grid gap-4 ${GRID_CLASSES[cards] ?? GRID_CLASSES[4]}`}>
          {Array.from({ length: cards }, (_, index) => (
            <div key={index} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="mt-3 h-7 w-12" />
            </div>
          ))}
        </div>

        {rows > 0 && (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 bg-slate-50/80 px-4 py-3">
              <Skeleton className="h-3 w-32" />
            </div>
            <div className="divide-y divide-slate-100">
              {Array.from({ length: rows }, (_, index) => (
                <div key={index} className="flex items-center gap-4 px-4 py-3">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-4 w-12" />
                  <Skeleton className="ml-auto h-4 w-20" />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
