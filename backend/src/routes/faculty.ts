import { Router } from 'express';
import { z } from 'zod';
import { withTransaction } from '../db/transactions.js';
import { ApiError } from '../lib/errors.js';
import { hashPassword } from '../lib/password.js';
import { throwIfUniqueViolation } from '../lib/pg-errors.js';
import { emailSchema, fullNameSchema, passwordSchema, phoneSchema, registerNumberSchema, sectionSchema } from '../lib/schemas.js';
import { authenticatedUserId, requireAuth, requireRole } from '../middleware/auth.js';
import { validateBody, validateParams } from '../middleware/validate.js';
import { logAudit } from '../services/audit.js';
import {
  getClassDetails,
  getClassForFaculty,
  listClassesForFaculty,
  type ClassRow,
} from '../services/classes.js';
import {
  createEnrollment,
  endEnrollment,
  findActiveEnrollment,
  listRoster,
} from '../services/enrollments.js';
import {
  createUser,
  findUserByEmail,
  findUserById,
  setUserPassword,
  updateUserProfile,
} from '../services/users.js';

/**
 * Faculty routes. Students are created and enrolled only by faculty assigned
 * to the class; every handler first checks that the caller holds an active
 * assignment for the class (otherwise the response is a plain 404, so class
 * existence is not leaked).
 */

export const facultyRouter = Router();

facultyRouter.use('/faculty', requireAuth, requireRole('faculty'));

const classParamSchema = z.object({ id: z.uuid('must be a valid class id') });

const studentParamSchema = z.object({
  id: z.uuid('must be a valid class id'),
  studentUserId: z.uuid('must be a valid student id'),
});

const studentCreateSchema = z.object({
  fullName: fullNameSchema,
  email: emailSchema,
  password: passwordSchema,
  registerNumber: registerNumberSchema.optional(),
  phone: phoneSchema.optional(),
  section: sectionSchema.optional(),
});

const studentUpdateSchema = z
  .object({
    fullName: fullNameSchema.optional(),
    email: emailSchema.optional(),
    registerNumber: registerNumberSchema.optional(),
    phone: phoneSchema.optional(),
    section: sectionSchema.optional(),
  })
  .refine(
    (value) =>
      value.fullName !== undefined ||
      value.email !== undefined ||
      value.registerNumber !== undefined ||
      value.phone !== undefined ||
      value.section !== undefined,
    { message: 'provide at least one field to update' },
  );

const enrollExistingSchema = z.object({ email: emailSchema });

const passwordResetSchema = z.object({ newPassword: passwordSchema });

const USERS_UNIQUE_MESSAGES: Record<string, string> = {
  users_email_lower_key: 'An account with this email already exists.',
  users_register_number_key: 'Another student account already uses this register number.',
};

const NOT_ENROLLED_MESSAGE = 'Student is not actively enrolled in this class.';

/** Class scoped to the caller's active assignments; null means 404 later. */
async function requireFacultyClass(facultyUserId: string, classId: string): Promise<ClassRow> {
  const row = await getClassForFaculty(classId, facultyUserId);
  if (!row) {
    throw new ApiError(404, 'Class not found.');
  }
  return row;
}

/** GET /api/faculty/classes — classes this faculty member is assigned to. */
facultyRouter.get('/faculty/classes', async (req, res) => {
  res.json({ classes: await listClassesForFaculty(authenticatedUserId(req)) });
});

/** GET /api/faculty/classes/:id — class details plus current and past roster. */
facultyRouter.get('/faculty/classes/:id', validateParams(classParamSchema), async (req, res) => {
  const { id } = req.params as { id: string };
  const facultyUserId = authenticatedUserId(req);

  const classRow = await requireFacultyClass(facultyUserId, id);
  const [details, roster] = await Promise.all([
    getClassDetails(classRow.id),
    listRoster(classRow.id),
  ]);
  if (!details) {
    throw new Error('faculty: class details missing for an assigned class');
  }
  res.json({ class: details, students: roster.students, formerStudents: roster.formerStudents });
});

/** POST /api/faculty/classes/:id/students — create a student account and enroll it. */
facultyRouter.post(
  '/faculty/classes/:id/students',
  validateParams(classParamSchema),
  validateBody(studentCreateSchema),
  async (req, res) => {
    const { id } = req.params as { id: string };
    const input = req.body as z.infer<typeof studentCreateSchema>;
    const actorUserId = authenticatedUserId(req);

    await requireFacultyClass(actorUserId, id);

    const existing = await findUserByEmail(input.email);
    if (existing) {
      throw new ApiError(
        409,
        'An account with this email already exists. If it is a student, use "Enroll existing student" instead.',
      );
    }

    const passwordHash = await hashPassword(input.password);
    const created = await withTransaction(async (client) => {
      const student = await createUser(
        {
          email: input.email,
          fullName: input.fullName,
          role: 'student',
          passwordHash,
          registerNumber: input.registerNumber ?? null,
          phone: input.phone ?? null,
          section: input.section ?? null,
        },
        client,
      ).catch((error: unknown) =>
        throwIfUniqueViolation(error, USERS_UNIQUE_MESSAGES, 'A conflicting account already exists.'),
      );
      const enrollment = await createEnrollment(id, student.id, client);
      await logAudit(
        {
          actorUserId,
          action: 'faculty.student_create',
          entityType: 'user',
          entityId: student.id,
          newValue: {
            email: student.email,
            fullName: student.fullName,
            registerNumber: student.registerNumber,
            section: student.section,
            classId: id,
          },
          ip: req.ip ?? null,
        },
        client,
      );
      await logAudit(
        {
          actorUserId,
          action: 'faculty.student_enroll',
          entityType: 'enrollment',
          entityId: enrollment.id,
          newValue: { classId: id, studentUserId: student.id },
          ip: req.ip ?? null,
        },
        client,
      );
      return { student, enrollment };
    });

    res.status(201).json({
      student: {
        id: created.student.id,
        email: created.student.email,
        fullName: created.student.fullName,
        isActive: created.student.isActive,
      },
      enrollment: created.enrollment,
    });
  },
);

/** POST /api/faculty/classes/:id/enroll — enroll an existing student account. */
facultyRouter.post(
  '/faculty/classes/:id/enroll',
  validateParams(classParamSchema),
  validateBody(enrollExistingSchema),
  async (req, res) => {
    const { id } = req.params as { id: string };
    const { email } = req.body as z.infer<typeof enrollExistingSchema>;
    const actorUserId = authenticatedUserId(req);

    await requireFacultyClass(actorUserId, id);

    const student = await findUserByEmail(email);
    if (!student || student.role !== 'student') {
      throw new ApiError(404, 'No student account found with this email address.');
    }
    if (!student.isActive) {
      throw new ApiError(409, 'This student account is deactivated. Activate it first.');
    }
    const active = await findActiveEnrollment(id, student.id);
    if (active) {
      throw new ApiError(409, 'This student is already enrolled in this class.');
    }

    const enrollment = await withTransaction(async (client) => {
      const row = await createEnrollment(id, student.id, client).catch((error: unknown) =>
        throwIfUniqueViolation(
          error,
          { enrollments_active_key: 'This student is already enrolled in this class.' },
          'This student is already enrolled in this class.',
        ),
      );
      await logAudit(
        {
          actorUserId,
          action: 'faculty.student_enroll',
          entityType: 'enrollment',
          entityId: row.id,
          newValue: { classId: id, studentUserId: student.id },
          ip: req.ip ?? null,
        },
        client,
      );
      return row;
    });

    res.status(201).json({
      student: {
        id: student.id,
        email: student.email,
        fullName: student.fullName,
        isActive: student.isActive,
      },
      enrollment,
    });
  },
);

/** PATCH /api/faculty/classes/:id/students/:studentUserId — update permitted info. */
facultyRouter.patch(
  '/faculty/classes/:id/students/:studentUserId',
  validateParams(studentParamSchema),
  validateBody(studentUpdateSchema),
  async (req, res) => {
    const { id, studentUserId } = req.params as { id: string; studentUserId: string };
    const input = req.body as z.infer<typeof studentUpdateSchema>;
    const actorUserId = authenticatedUserId(req);

    await requireFacultyClass(actorUserId, id);

    const target = await findUserById(studentUserId);
    const enrollment = target ? await findActiveEnrollment(id, studentUserId) : null;
    if (!target || target.role !== 'student' || !enrollment) {
      throw new ApiError(404, NOT_ENROLLED_MESSAGE);
    }

    const updated = await withTransaction(async (client) => {
      const row = await updateUserProfile(
        studentUserId,
        {
          fullName: input.fullName ?? target.fullName,
          email: input.email ?? target.email,
          registerNumber: input.registerNumber ?? null,
          phone: input.phone ?? null,
          section: input.section ?? null,
        },
        client,
      ).catch((error: unknown) =>
        throwIfUniqueViolation(error, USERS_UNIQUE_MESSAGES, 'A conflicting account already exists.'),
      );
      if (!row) {
        throw new ApiError(404, NOT_ENROLLED_MESSAGE);
      }
      await logAudit(
        {
          actorUserId,
          action: 'faculty.student_update',
          entityType: 'user',
          entityId: studentUserId,
          oldValue: {
            fullName: target.fullName,
            email: target.email,
            registerNumber: target.registerNumber,
            section: target.section,
          },
          newValue: {
            fullName: row.fullName,
            email: row.email,
            registerNumber: row.registerNumber,
            section: row.section,
          },
          ip: req.ip ?? null,
        },
        client,
      );
      return row;
    });

    res.json({
      student: {
        id: updated.id,
        email: updated.email,
        fullName: updated.fullName,
        isActive: updated.isActive,
      },
    });
  },
);

/** POST /api/faculty/classes/:id/students/:studentUserId/unenroll — end enrollment. */
facultyRouter.post(
  '/faculty/classes/:id/students/:studentUserId/unenroll',
  validateParams(studentParamSchema),
  async (req, res) => {
    const { id, studentUserId } = req.params as { id: string; studentUserId: string };
    const actorUserId = authenticatedUserId(req);

    await requireFacultyClass(actorUserId, id);

    const enrollment = await findActiveEnrollment(id, studentUserId);
    if (!enrollment) {
      throw new ApiError(404, NOT_ENROLLED_MESSAGE);
    }

    const ended = await withTransaction(async (client) => {
      const row = await endEnrollment(enrollment.id, client);
      if (!row) {
        throw new ApiError(409, 'This enrollment has already ended.');
      }
      await logAudit(
        {
          actorUserId,
          action: 'faculty.student_unenroll',
          entityType: 'enrollment',
          entityId: row.id,
          oldValue: { classId: id, studentUserId, unenrolledAt: null },
          newValue: { unenrolledAt: row.unenrolledAt },
          ip: req.ip ?? null,
        },
        client,
      );
      return row;
    });

    res.json({ enrollment: ended });
  },
);

/** POST /api/faculty/classes/:id/students/:studentUserId/reset-password. */
facultyRouter.post(
  '/faculty/classes/:id/students/:studentUserId/reset-password',
  validateParams(studentParamSchema),
  validateBody(passwordResetSchema),
  async (req, res) => {
    const { id, studentUserId } = req.params as { id: string; studentUserId: string };
    const { newPassword } = req.body as z.infer<typeof passwordResetSchema>;
    const actorUserId = authenticatedUserId(req);

    await requireFacultyClass(actorUserId, id);

    const enrollment = await findActiveEnrollment(id, studentUserId);
    if (!enrollment) {
      throw new ApiError(404, NOT_ENROLLED_MESSAGE);
    }

    const passwordHash = await hashPassword(newPassword);
    await withTransaction(async (client) => {
      await setUserPassword(studentUserId, passwordHash, client);
      await logAudit(
        {
          actorUserId,
          action: 'faculty.student_password_reset',
          entityType: 'user',
          entityId: studentUserId,
          ip: req.ip ?? null,
        },
        client,
      );
    });

    res.status(204).end();
  },
);
