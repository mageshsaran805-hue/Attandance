import { Router, type RequestHandler } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { z } from 'zod';
import { env } from '../config/env.js';
import { withTransaction } from '../db/transactions.js';
import { ApiError } from '../lib/errors.js';
import { generateOtp, hashOtp, otpInputPattern, otpMatches } from '../lib/otp.js';
import { throwIfUniqueViolation } from '../lib/pg-errors.js';
import { todayInTimeZone } from '../lib/time.js';
import { authenticatedUserId, requireAuth, requireRole } from '../middleware/auth.js';
import { validateBody, validateParams } from '../middleware/validate.js';
import {
  closeSession,
  countFailedOtpAttempts,
  findRecord,
  findSessionForClassDate,
  findSessionForStudentMark,
  getSessionForFaculty,
  getSessionSummaryById,
  getStudentToday,
  insertOtpMark,
  listRecentSessionsForClass,
  listSessionStudents,
  markAllEnrolledStudents,
  materializeAbsentStudents,
  openSession,
  recordOtpAttempt,
  updateSessionOtp,
  upsertManualMark,
} from '../services/attendance.js';
import { logAudit } from '../services/audit.js';
import { getClassForFaculty } from '../services/classes.js';
import { findActiveEnrollment } from '../services/enrollments.js';

/**
 * Attendance routes.
 *
 * Faculty: open today's session for an assigned class, show/regenerate the
 * OTP, mark or correct students manually, close the session.
 * Students: see today's session for their classes and self-mark with the OTP.
 *
 * Scope rule: sessions are always reached through the caller's active class
 * assignment (faculty) or active enrollment (student); anything else is a
 * plain 404 so resource existence is not leaked.
 */

export const attendanceRouter = Router();

const facultyOnly: RequestHandler[] = [requireAuth, requireRole('faculty')];
const studentOnly: RequestHandler[] = [requireAuth, requireRole('student')];

/**
 * Failed self-marking attempts are limited per student (30 per 15 minutes);
 * successful marks are not counted, so a shared campus IP or a whole class
 * marking at once is never throttled. Per-OTP code attempts are separately
 * capped in the database (OTP_MAX_ATTEMPTS per generation); this limiter only
 * blunts scripted hammering across sessions.
 */
const markRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1_000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req.ip ?? ''),
  handler: (_req, res) => {
    res
      .status(429)
      .json({ error: 'Too many attendance marking attempts. Try again in a few minutes.' });
  },
});

const classParamSchema = z.object({ id: z.uuid('must be a valid class id') });
const sessionParamSchema = z.object({ sessionId: z.uuid('must be a valid session id') });

const manualMarkSchema = z.object({
  studentUserId: z.uuid('must be a valid student id'),
  status: z.enum(['present', 'absent'], 'must be present or absent'),
});

const markAllSchema = z.object({
  status: z.enum(['present', 'absent'], 'must be present or absent'),
});

const otpBodySchema = z.object({
  otp: z.string().trim().regex(otpInputPattern(), `must be exactly ${env.OTP_LENGTH} digits`),
});

const SESSION_ALREADY_EXISTS = "Today's attendance session for this class already exists.";
const OTP_LOCKED_MESSAGE =
  'Too many incorrect attempts. Ask your faculty member to regenerate the OTP.';
const NOT_ENROLLED_MESSAGE = 'This student is not enrolled in the class for this session.';

/** Class scoped to the caller's active assignments; null means 404 later. */
async function requireFacultyClass(facultyUserId: string, classId: string) {
  const row = await getClassForFaculty(classId, facultyUserId);
  if (!row) {
    throw new ApiError(404, 'Class not found.');
  }
  return row;
}

/** Session scoped to the caller's active assignments; null means 404 later. */
async function requireFacultySession(facultyUserId: string, sessionId: string) {
  const row = await getSessionForFaculty(sessionId, facultyUserId);
  if (!row) {
    throw new ApiError(404, 'Attendance session not found.');
  }
  return row;
}

/** GET /api/faculty/classes/:id/sessions — today's session and recent history. */
attendanceRouter.get(
  '/faculty/classes/:id/sessions',
  ...facultyOnly,
  validateParams(classParamSchema),
  async (req, res) => {
    const { id } = req.params as { id: string };
    const actorUserId = authenticatedUserId(req);
    await requireFacultyClass(actorUserId, id);

    const today = todayInTimeZone();
    const [todaySession, recent] = await Promise.all([
      findSessionForClassDate(id, today),
      listRecentSessionsForClass(id, today, 10),
    ]);
    res.json({ today: todaySession, recent });
  },
);

/** POST /api/faculty/classes/:id/sessions — open today's session and OTP. */
attendanceRouter.post(
  '/faculty/classes/:id/sessions',
  ...facultyOnly,
  validateParams(classParamSchema),
  async (req, res) => {
    const { id } = req.params as { id: string };
    const actorUserId = authenticatedUserId(req);
    await requireFacultyClass(actorUserId, id);

    const sessionDate = todayInTimeZone();
    const existing = await findSessionForClassDate(id, sessionDate);
    if (existing) {
      throw new ApiError(
        409,
        existing.status === 'open'
          ? "Today's session for this class is already open."
          : "Today's session for this class has already been completed.",
      );
    }

    const otp = generateOtp();
    const session = await withTransaction(async (client) => {
      const row = await openSession(
        {
          classId: id,
          sessionDate,
          otpHash: hashOtp(otp),
          otpTtlMinutes: env.OTP_TTL_MINUTES,
          startedBy: actorUserId,
        },
        client,
      ).catch((error: unknown) =>
        throwIfUniqueViolation(
          error,
          { attendance_sessions_class_date_key: SESSION_ALREADY_EXISTS },
          SESSION_ALREADY_EXISTS,
        ),
      );
      await logAudit(
        {
          actorUserId,
          action: 'session.open',
          entityType: 'attendance_session',
          entityId: row.id,
          newValue: { classId: id, sessionDate },
          ip: req.ip ?? null,
        },
        client,
      );
      return row;
    });

    res.status(201).json({ session, otp });
  },
);

/** GET /api/faculty/sessions/:sessionId — session plus attendance roster. */
attendanceRouter.get(
  '/faculty/sessions/:sessionId',
  ...facultyOnly,
  validateParams(sessionParamSchema),
  async (req, res) => {
    const { sessionId } = req.params as { sessionId: string };
    const actorUserId = authenticatedUserId(req);
    const session = await requireFacultySession(actorUserId, sessionId);
    const students = await listSessionStudents(session.id, session.classId);
    res.json({ session, students });
  },
);

/** POST /api/faculty/sessions/:sessionId/otp — new OTP; the old one dies. */
attendanceRouter.post(
  '/faculty/sessions/:sessionId/otp',
  ...facultyOnly,
  validateParams(sessionParamSchema),
  async (req, res) => {
    const { sessionId } = req.params as { sessionId: string };
    const actorUserId = authenticatedUserId(req);
    const session = await requireFacultySession(actorUserId, sessionId);
    if (session.status === 'closed') {
      throw new ApiError(409, 'This session is closed; the OTP cannot be regenerated.');
    }

    const otp = generateOtp();
    const expiresAt = await withTransaction(async (client) => {
      const expiry = await updateSessionOtp(sessionId, hashOtp(otp), env.OTP_TTL_MINUTES, client);
      if (expiry === null) {
        throw new ApiError(409, 'This session is closed; the OTP cannot be regenerated.');
      }
      // Never store the raw OTP or its hash in the audit trail.
      await logAudit(
        {
          actorUserId,
          action: 'session.otp_regenerate',
          entityType: 'attendance_session',
          entityId: sessionId,
          newValue: { otpExpiresAt: expiry },
          ip: req.ip ?? null,
        },
        client,
      );
      return expiry;
    });

    res.json({ otp, expiresAt });
  },
);

/** POST /api/faculty/sessions/:sessionId/mark — manual mark or correction. */
attendanceRouter.post(
  '/faculty/sessions/:sessionId/mark',
  ...facultyOnly,
  validateParams(sessionParamSchema),
  validateBody(manualMarkSchema),
  async (req, res) => {
    const { sessionId } = req.params as { sessionId: string };
    const { studentUserId, status } = req.body as z.infer<typeof manualMarkSchema>;
    const actorUserId = authenticatedUserId(req);
    const session = await requireFacultySession(actorUserId, sessionId);

    // Allowed while actively enrolled, or when correcting an existing record
    // of a student who has since left the class.
    const enrollment = await findActiveEnrollment(session.classId, studentUserId);

    const record = await withTransaction(async (client) => {
      const previous = await findRecord(session.id, studentUserId, client);
      if (!enrollment && !previous) {
        throw new ApiError(404, NOT_ENROLLED_MESSAGE);
      }
      const updated = await upsertManualMark(
        { sessionId: session.id, studentUserId, status, actorUserId },
        client,
      );
      await logAudit(
        {
          actorUserId,
          action: 'session.manual_mark',
          entityType: 'attendance_record',
          entityId: updated.id,
          oldValue: previous ? { status: previous.status, method: previous.method } : null,
          newValue: { studentUserId, status: updated.status, method: updated.method },
          ip: req.ip ?? null,
        },
        client,
      );
      return updated;
    });

    res.json({ record });
  },
);

/** POST /api/faculty/sessions/:sessionId/mark-all — full present/absent in one step. */
attendanceRouter.post(
  '/faculty/sessions/:sessionId/mark-all',
  ...facultyOnly,
  validateParams(sessionParamSchema),
  validateBody(markAllSchema),
  async (req, res) => {
    const { sessionId } = req.params as { sessionId: string };
    const { status } = req.body as z.infer<typeof markAllSchema>;
    const actorUserId = authenticatedUserId(req);
    const session = await requireFacultySession(actorUserId, sessionId);

    // Open or closed: the whole roster is (re)marked, like a manual
    // correction applied to everyone who is still actively enrolled.
    const marked = await withTransaction(async (client) => {
      const count = await markAllEnrolledStudents(session.id, status, actorUserId, client);
      await logAudit(
        {
          actorUserId,
          action: 'session.mark_all',
          entityType: 'attendance_session',
          entityId: session.id,
          newValue: { status, count },
          ip: req.ip ?? null,
        },
        client,
      );
      return count;
    });

    res.json({ marked, status });
  },
);

/** POST /api/faculty/sessions/:sessionId/close — absent for pending, then lock. */
attendanceRouter.post(
  '/faculty/sessions/:sessionId/close',
  ...facultyOnly,
  validateParams(sessionParamSchema),
  async (req, res) => {
    const { sessionId } = req.params as { sessionId: string };
    const actorUserId = authenticatedUserId(req);
    const session = await requireFacultySession(actorUserId, sessionId);
    if (session.status === 'closed') {
      throw new ApiError(409, 'This session is already closed.');
    }

    const absentAdded = await withTransaction(async (client) => {
      const closed = await closeSession(session.id, actorUserId, client);
      if (!closed) {
        throw new ApiError(409, 'This session is already closed.');
      }
      const materialized = await materializeAbsentStudents(session.id, actorUserId, client);
      await logAudit(
        {
          actorUserId,
          action: 'session.close',
          entityType: 'attendance_session',
          entityId: session.id,
          newValue: {
            classId: session.classId,
            sessionDate: session.sessionDate,
            absentAdded: materialized,
          },
          ip: req.ip ?? null,
        },
        client,
      );
      return materialized;
    });

    const updated = await getSessionSummaryById(session.id);
    res.json({ session: updated, absentAdded });
  },
);

/** GET /api/student/attendance/today — own classes, sessions and records. */
attendanceRouter.get('/student/attendance/today', ...studentOnly, async (req, res) => {
  const studentUserId = authenticatedUserId(req);
  const date = todayInTimeZone();
  res.json({ date, classes: await getStudentToday(studentUserId, date) });
});

/** POST /api/student/sessions/:sessionId/mark — self-mark with the OTP. */
attendanceRouter.post(
  '/student/sessions/:sessionId/mark',
  ...studentOnly,
  markRateLimiter,
  validateParams(sessionParamSchema),
  validateBody(otpBodySchema),
  async (req, res) => {
    const { sessionId } = req.params as { sessionId: string };
    const { otp } = req.body as z.infer<typeof otpBodySchema>;
    const studentUserId = authenticatedUserId(req);
    const ip = req.ip ?? null;

    const session = await findSessionForStudentMark(sessionId, studentUserId);
    if (!session) {
      throw new ApiError(404, 'Attendance session not found.');
    }
    if (session.status === 'closed') {
      throw new ApiError(
        409,
        'This session is already closed. Your faculty member can still correct your attendance.',
      );
    }
    if (session.otpHash === null || session.otpExpiresAt === null) {
      throw new ApiError(409, 'No OTP is currently active for this session.');
    }

    const today = todayInTimeZone();
    if (session.sessionDate !== today) {
      throw new ApiError(409, 'This session is not open for marking today.');
    }

    const expiresAtMs = new Date(session.otpExpiresAt).getTime();
    if (expiresAtMs <= Date.now()) {
      throw new ApiError(409, 'The OTP has expired. Ask your faculty member to show or regenerate it.');
    }

    const existing = await findRecord(session.id, studentUserId);
    if (existing) {
      throw new ApiError(
        409,
        'Your attendance for this session is already recorded. Ask your faculty member to correct it if needed.',
      );
    }

    // Failed attempts count against the current OTP generation only.
    const failures = await countFailedOtpAttempts(session.id, studentUserId, env.OTP_TTL_MINUTES);
    if (failures >= env.OTP_MAX_ATTEMPTS) {
      throw new ApiError(429, OTP_LOCKED_MESSAGE);
    }

    if (!otpMatches(otp, session.otpHash)) {
      await recordOtpAttempt({ sessionId: session.id, studentUserId, success: false, ip });
      const attemptsRemaining = Math.max(0, env.OTP_MAX_ATTEMPTS - failures - 1);
      if (attemptsRemaining === 0) {
        throw new ApiError(429, OTP_LOCKED_MESSAGE);
      }
      res.status(400).json({
        error: `Incorrect OTP. ${attemptsRemaining} ${attemptsRemaining === 1 ? 'attempt' : 'attempts'} remaining.`,
        attemptsRemaining,
      });
      return;
    }

    const record = await withTransaction(async (client) => {
      await recordOtpAttempt({ sessionId: session.id, studentUserId, success: true, ip }, client);
      const inserted = await insertOtpMark(session.id, studentUserId, client);
      if (!inserted) {
        throw new ApiError(
          409,
          'Your attendance for this session is already recorded. Ask your faculty member to correct it if needed.',
        );
      }
      await logAudit(
        {
          actorUserId: studentUserId,
          action: 'session.otp_mark',
          entityType: 'attendance_record',
          entityId: inserted.id,
          newValue: {
            sessionId: session.id,
            classId: session.classId,
            status: inserted.status,
            method: inserted.method,
          },
          ip,
        },
        client,
      );
      return inserted;
    });

    res.status(201).json({ record });
  },
);
