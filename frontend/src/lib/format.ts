/**
 * Display formatting helpers. All attendance-related dates are shown in the
 * college timezone (Asia/Kolkata), matching the backend's APP_TIMEZONE.
 */

const TIME_ZONE = 'Asia/Kolkata'

const dateFormatter = new Intl.DateTimeFormat('en-IN', {
  timeZone: TIME_ZONE,
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

const shortDateFormatter = new Intl.DateTimeFormat('en-IN', {
  timeZone: TIME_ZONE,
  day: 'numeric',
  month: 'short',
})

const dateTimeFormatter = new Intl.DateTimeFormat('en-IN', {
  timeZone: TIME_ZONE,
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

const timeFormatter = new Intl.DateTimeFormat('en-IN', {
  timeZone: TIME_ZONE,
  hour: 'numeric',
  minute: '2-digit',
})

export function formatDate(value: string | null | undefined): string {
  if (!value) {
    return '—'
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : dateFormatter.format(date)
}

/** Compact date for chart axes, e.g. "20 Oct". */
export function formatShortDate(value: string | null | undefined): string {
  if (!value) {
    return '—'
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : shortDateFormatter.format(date)
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return '—'
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : dateTimeFormatter.format(date)
}

export function formatTime(value: string | null | undefined): string {
  if (!value) {
    return '—'
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : timeFormatter.format(date)
}

/** Attendance percentage (already rounded by the backend) or an em dash. */
export function formatPercent(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : `${value.toFixed(1)}%`
}

// ---------------------------------------------------------------------------
// ISO calendar dates for report range pickers (college timezone)
// ---------------------------------------------------------------------------

const isoDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** Today's calendar date in the college timezone as YYYY-MM-DD. */
export function todayIso(): string {
  return isoDateFormatter.format(new Date())
}

/** Shifts a YYYY-MM-DD date by whole days using pure date arithmetic. */
export function shiftIsoDate(date: string, days: number): string {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number)
  const base = new Date(Date.UTC(year, month - 1, day))
  base.setUTCDate(base.getUTCDate() + days)
  return base.toISOString().slice(0, 10)
}

/** Default report window: the last 30 days including today. */
export function defaultRangeIso(): { from: string; to: string } {
  const today = todayIso()
  return { from: shiftIsoDate(today, -29), to: today }
}
