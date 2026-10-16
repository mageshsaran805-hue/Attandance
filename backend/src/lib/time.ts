import { env } from '../config/env.js';

/**
 * Attendance dates are calendar dates in the college timezone
 * (APP_TIMEZONE, default Asia/Kolkata), not in the server's local timezone.
 * formatToParts is used so the result does not depend on locale ordering.
 */

export function dateInTimeZone(timeZone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);

  const value = (type: 'year' | 'month' | 'day'): string =>
    parts.find((part) => part.type === type)?.value ?? '';

  return `${value('year')}-${value('month')}-${value('day')}`;
}

/** Today's attendance date for the configured college timezone. */
export function todayInTimeZone(now: Date = new Date()): string {
  return dateInTimeZone(env.APP_TIMEZONE, now);
}

/**
 * Shifts a YYYY-MM-DD calendar date by whole days with pure UTC string
 * arithmetic, so the result never depends on the server's local timezone.
 */
export function shiftDate(date: string, days: number): string {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  const base = new Date(Date.UTC(year, month - 1, day));
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

/** Whole days between two YYYY-MM-DD dates (`to` minus `from`). */
export function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000,
  );
}
