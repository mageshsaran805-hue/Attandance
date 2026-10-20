type LogoVariant = 'dark' | 'light'

/**
 * App wordmark used on the public auth screens and in the signed-in header.
 * The mark is inline SVG so it stays crisp and needs no extra asset request.
 */
export default function Logo({
  variant = 'dark',
  compact = false,
  subtitle = 'Daily morning attendance',
}: {
  variant?: LogoVariant
  compact?: boolean
  subtitle?: string
}) {
  const light = variant === 'light'
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span
        aria-hidden="true"
        className={`grid shrink-0 place-items-center rounded-2xl bg-linear-to-br from-indigo-500 to-indigo-700 text-white shadow-lg shadow-indigo-950/25 ring-1 ring-white/20 ${
          compact ? 'size-10' : 'size-11'
        }`}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={compact ? 'size-5' : 'size-6'}
        >
          <path d="M3.75 9.75 12 5.25l8.25 4.5L12 14.25 3.75 9.75Z" />
          <path d="M6.75 11.25v4.5c0 .621.504 1.125 1.125 1.125h8.25c.621 0 1.125-.504 1.125-1.125v-4.5" />
          <path d="M20.25 9.75v5.25" />
        </svg>
      </span>
      <div className="min-w-0">
        <p
          className={`truncate font-semibold leading-tight ${
            compact ? 'text-sm sm:text-base' : 'text-base'
          } ${light ? 'text-white' : 'text-slate-900'}`}
        >
          College Attendance
        </p>
        {subtitle && (
          <p className={`truncate text-xs ${light ? 'text-indigo-200/80' : 'text-slate-600'}`}>
            {subtitle}
          </p>
        )}
      </div>
    </div>
  )
}
