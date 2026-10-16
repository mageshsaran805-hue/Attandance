import { describe, expect, it } from 'vitest';
import { dateInTimeZone, todayInTimeZone } from './time.js';

describe('dateInTimeZone', () => {
  it('uses the calendar date of the given time zone', () => {
    const instant = new Date('2026-01-15T23:30:00Z');
    expect(dateInTimeZone('UTC', instant)).toBe('2026-01-15');
    expect(dateInTimeZone('Asia/Kolkata', instant)).toBe('2026-01-16'); // UTC+05:30
  });

  it('returns a padded YYYY-MM-DD date for the configured zone', () => {
    expect(todayInTimeZone()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
