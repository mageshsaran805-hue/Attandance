import { Router, type Request, type RequestHandler } from 'express';
import { z } from 'zod';
import { ApiError } from '../lib/errors.js';
import { daysBetween, shiftDate, todayInTimeZone } from '../lib/time.js';
import { authenticatedUserId, requireAuth, requireRole } from '../middleware/auth.js';
import { parseQuery, validateParams } from '../middleware/validate.js';
import { getClassForDepartment, getClassForFaculty } from '../services/classes.js';
import { findDepartmentHeadedBy, type DepartmentRow } from '../services/departments.js';
import {
  getClassReport,
  getDepartmentReport,
  getStudentHistory,
  getSystemReport,
} from '../services/reports.js';

/**
 * Reporting routes (Phase 5).
 *
 * Scope rules: faculty see reports for classes they are assigned to, HODs for
 * their own department, admins system-wide, and students only their own
 * attendance history. Out-of-scope resources are a plain 404 so existence is
 * never leaked.
 *
 * Ranges are YYYY-MM-DD calendar dates in the college timezone; when omitted
 * they default to the last 30 days. Percentages are computed from closed
 * sessions only (see services/reports.ts).
 */

export const reportsRouter = Router();

const facultyOnly: RequestHandler[] = [requireAuth, requireRole('faculty')];
const hodOnly: RequestHandler[] = [requireAuth, requireRole('hod')];
const adminOnly: RequestHandler[] = [requireAuth, requireRole('admin')];
const studentOnly: RequestHandler[] = [requireAuth, requireRole('student')];

const classParamSchema = z.object({ id: z.uuid('must be a valid class id') });

const emptyToUndefined = (value: unknown) => (value === '' ? undefined : value);

const rangeQuerySchema = z.object({
  from: z.preprocess(emptyToUndefined, z.iso.date().optional()),
  to: z.preprocess(emptyToUndefined, z.iso.date().optional()),
});

const DEFAULT_RANGE_DAYS = 30;
const MAX_RANGE_DAYS = 366;

/** Resolves ?from&to into a validated range, defaulting to the last 30 days. */
function resolveDateRange(query: unknown): { from: string; to: string } {
  const { from: rawFrom, to: rawTo } = parseQuery(query, rangeQuerySchema);
  const today = todayInTimeZone();
  const from = rawFrom ?? shiftDate(today, -(DEFAULT_RANGE_DAYS - 1));
  const to = rawTo ?? today;

  if (from > to) {
    throw new ApiError(400, 'Invalid range: "from" must not be after "to".');
  }
  if (daysBetween(from, to) > MAX_RANGE_DAYS) {
    throw new ApiError(400, `Invalid range: at most ${MAX_RANGE_DAYS} days per report.`);
  }
  return { from, to };
}

async function requireHodDepartment(req: Request): Promise<DepartmentRow> {
  const department = await findDepartmentHeadedBy(authenticatedUserId(req));
  if (!department) {
    throw new ApiError(404, 'No department is assigned to your account yet.');
  }
  return department;
}

/** GET /api/faculty/classes/:id/report — attendance report for an assigned class. */
reportsRouter.get(
  '/faculty/classes/:id/report',
  ...facultyOnly,
  validateParams(classParamSchema),
  async (req, res) => {
    const { id } = req.params as { id: string };
    const range = resolveDateRange(req.query);

    if (!(await getClassForFaculty(id, authenticatedUserId(req)))) {
      throw new ApiError(404, 'Class not found.');
    }

    const report = await getClassReport(id, range.from, range.to);
    if (!report) {
      throw new ApiError(404, 'Class not found.');
    }
    res.json(report);
  },
);

/** GET /api/hod/reports/attendance — department-wide attendance summary. */
reportsRouter.get('/hod/reports/attendance', ...hodOnly, async (req, res) => {
  const department = await requireHodDepartment(req);
  const range = resolveDateRange(req.query);

  const report = await getDepartmentReport(department.id, range.from, range.to);
  if (!report) {
    throw new ApiError(404, 'No department is assigned to your account yet.');
  }
  res.json(report);
});

/** GET /api/hod/classes/:id/report — class detail within the HOD's department. */
reportsRouter.get(
  '/hod/classes/:id/report',
  ...hodOnly,
  validateParams(classParamSchema),
  async (req, res) => {
    const department = await requireHodDepartment(req);
    const { id } = req.params as { id: string };
    const range = resolveDateRange(req.query);

    if (!(await getClassForDepartment(id, department.id))) {
      throw new ApiError(404, 'Class not found.');
    }

    const report = await getClassReport(id, range.from, range.to);
    if (!report) {
      throw new ApiError(404, 'Class not found.');
    }
    res.json(report);
  },
);

/** GET /api/admin/reports/attendance — system-wide attendance summary. */
reportsRouter.get('/admin/reports/attendance', ...adminOnly, async (req, res) => {
  const range = resolveDateRange(req.query);
  res.json(await getSystemReport(range.from, range.to));
});

/** GET /api/student/attendance/history — the student's own attendance history. */
reportsRouter.get('/student/attendance/history', ...studentOnly, async (req, res) => {
  const range = resolveDateRange(req.query);
  res.json(await getStudentHistory(authenticatedUserId(req), range.from, range.to));
});
