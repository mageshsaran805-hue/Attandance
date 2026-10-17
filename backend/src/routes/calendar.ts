import { Router } from 'express';
import { z } from 'zod';
import { withTransaction } from '../db/transactions.js';
import { ApiError } from '../lib/errors.js';
import { throwIfUniqueViolation } from '../lib/pg-errors.js';
import { daysBetween, todayInTimeZone } from '../lib/time.js';
import { authenticatedUserId, requireAuth, requireRole } from '../middleware/auth.js';
import { parseQuery, validateBody, validateParams } from '../middleware/validate.js';
import { logAudit } from '../services/audit.js';
import {
  createNonWorkingDay,
  deleteNonWorkingDay,
  listNonWorkingDays,
} from '../services/calendar.js';

/**
 * College calendar routes (non-working days).
 *
 * Any signed-in role can read the calendar (students and faculty see it in
 * their views); only administrators can add or remove entries, and every
 * mutation is audit-logged. Ranges are YYYY-MM-DD calendar dates in the
 * college timezone, defaulting to the current calendar year.
 */

export const calendarRouter = Router();
export const adminCalendarRouter = Router();

adminCalendarRouter.use('/admin', requireAuth, requireRole('admin'));

const emptyToUndefined = (value: unknown) => (value === '' ? undefined : value);

const calendarRangeQuerySchema = z.object({
  from: z.preprocess(emptyToUndefined, z.iso.date().optional()),
  to: z.preprocess(emptyToUndefined, z.iso.date().optional()),
});

const uuidParamSchema = z.object({ id: z.uuid('must be a valid id') });

const nonWorkingDayCreateSchema = z.object({
  day: z.iso.date('must be a valid date (YYYY-MM-DD)'),
  label: z
    .string()
    .trim()
    .min(2, 'must be at least 2 characters')
    .max(120, 'must be at most 120 characters'),
});

const MAX_RANGE_DAYS = 366;

/** Resolves ?from&to, defaulting to the current calendar year. */
function resolveCalendarRange(query: unknown): { from: string; to: string } {
  const { from: rawFrom, to: rawTo } = parseQuery(query, calendarRangeQuerySchema);
  const year = todayInTimeZone().slice(0, 4);
  const from = rawFrom ?? `${year}-01-01`;
  const to = rawTo ?? `${year}-12-31`;

  if (from > to) {
    throw new ApiError(400, 'Invalid range: "from" must not be after "to".');
  }
  if (daysBetween(from, to) > MAX_RANGE_DAYS) {
    throw new ApiError(400, `Invalid range: at most ${MAX_RANGE_DAYS} days per request.`);
  }
  return { from, to };
}

const NON_WORKING_DAY_UNIQUE_MESSAGES: Record<string, string> = {
  non_working_days_day_key: 'This date is already marked as a non-working day.',
};

/** GET /api/calendar/non-working-days — holidays within a date range. */
calendarRouter.get('/calendar/non-working-days', requireAuth, async (req, res) => {
  const range = resolveCalendarRange(req.query);
  res.json({ nonWorkingDays: await listNonWorkingDays(range.from, range.to) });
});

/** POST /api/admin/calendar — mark a date as non-working. */
adminCalendarRouter.post(
  '/admin/calendar',
  validateBody(nonWorkingDayCreateSchema),
  async (req, res) => {
    const input = req.body as z.infer<typeof nonWorkingDayCreateSchema>;
    const actorUserId = authenticatedUserId(req);

    const created = await withTransaction(async (client) => {
      const row = await createNonWorkingDay(
        { day: input.day, label: input.label, createdBy: actorUserId },
        client,
      ).catch((error: unknown) =>
        throwIfUniqueViolation(
          error,
          NON_WORKING_DAY_UNIQUE_MESSAGES,
          'This date is already marked as a non-working day.',
        ),
      );
      await logAudit(
        {
          actorUserId,
          action: 'admin.calendar_create',
          entityType: 'non_working_day',
          entityId: row.id,
          newValue: { day: row.day, label: row.label },
          ip: req.ip ?? null,
        },
        client,
      );
      return row;
    });

    res.status(201).json({ nonWorkingDay: created });
  },
);

/** DELETE /api/admin/calendar/:id — remove a non-working day entry. */
adminCalendarRouter.delete(
  '/admin/calendar/:id',
  validateParams(uuidParamSchema),
  async (req, res) => {
    const { id } = req.params as { id: string };
    const actorUserId = authenticatedUserId(req);

    await withTransaction(async (client) => {
      const removed = await deleteNonWorkingDay(id, client);
      if (!removed) {
        throw new ApiError(404, 'Non-working day not found.');
      }
      await logAudit(
        {
          actorUserId,
          action: 'admin.calendar_delete',
          entityType: 'non_working_day',
          entityId: id,
          oldValue: { day: removed.day, label: removed.label },
          ip: req.ip ?? null,
        },
        client,
      );
    });

    res.status(204).end();
  },
);
