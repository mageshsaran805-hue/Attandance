import type { Pool, PoolClient } from 'pg';
import { getPool } from '../db/pool.js';
import { expectRow } from '../lib/errors.js';

/**
 * College calendar queries (non-working days).
 *
 * A non-working day is a date the college has declared a holiday. The list
 * is informational: it powers the calendar views and the warning shown to
 * faculty before opening a session on a holiday; it never blocks attendance
 * and it does not change report percentages.
 *
 * Mutating functions accept an optional transaction client so a caller can
 * commit the change together with its audit entry.
 */

export interface NonWorkingDayRow {
  id: string;
  /** YYYY-MM-DD calendar date in the college timezone. */
  day: string;
  label: string;
  createdAt: string;
}

interface DbNonWorkingDayRow {
  id: string;
  day: string;
  label: string;
  created_at: Date | string;
}

const NON_WORKING_DAY_COLUMNS = 'id, day::text AS day, label, created_at';

function mapNonWorkingDay(row: DbNonWorkingDayRow): NonWorkingDayRow {
  return {
    id: row.id,
    day: row.day,
    label: row.label,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

/** Entries within [from, to] (inclusive), oldest first. */
export async function listNonWorkingDays(
  from: string,
  to: string,
  client?: Pool | PoolClient,
): Promise<NonWorkingDayRow[]> {
  const db = client ?? getPool();
  const { rows } = await db.query<DbNonWorkingDayRow>(
    `SELECT ${NON_WORKING_DAY_COLUMNS} FROM non_working_days
      WHERE day BETWEEN $1::date AND $2::date
      ORDER BY day`,
    [from, to],
  );
  return rows.map(mapNonWorkingDay);
}

export async function createNonWorkingDay(
  input: { day: string; label: string; createdBy: string },
  client?: Pool | PoolClient,
): Promise<NonWorkingDayRow> {
  const db = client ?? getPool();
  const { rows } = await db.query<DbNonWorkingDayRow>(
    `INSERT INTO non_working_days (day, label, created_by)
     VALUES ($1, $2, $3)
     RETURNING ${NON_WORKING_DAY_COLUMNS}`,
    [input.day, input.label, input.createdBy],
  );
  return mapNonWorkingDay(expectRow(rows[0], 'non_working_days: insert'));
}

/** Removes an entry; null when it does not exist (already removed). */
export async function deleteNonWorkingDay(
  id: string,
  client?: Pool | PoolClient,
): Promise<NonWorkingDayRow | null> {
  const db = client ?? getPool();
  const { rows } = await db.query<DbNonWorkingDayRow>(
    `DELETE FROM non_working_days WHERE id = $1 RETURNING ${NON_WORKING_DAY_COLUMNS}`,
    [id],
  );
  const row = rows[0];
  return row ? mapNonWorkingDay(row) : null;
}
