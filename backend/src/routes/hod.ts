import { Router } from 'express';
import { z } from 'zod';
import { withTransaction } from '../db/transactions.js';
import { ApiError } from '../lib/errors.js';
import { throwIfUniqueViolation } from '../lib/pg-errors.js';
import { authenticatedUserId, requireAuth, requireRole } from '../middleware/auth.js';
import { validateBody, validateParams } from '../middleware/validate.js';
import { logAudit } from '../services/audit.js';
import {
  createAssignment,
  endAssignment,
  findAssignmentScope,
  listAssignmentsForClass,
} from '../services/class-faculty.js';
import { getClassDetails, getClassForDepartment, listClassesForDepartment } from '../services/classes.js';
import {
  findDepartmentHeadedBy,
  getDepartmentOverviewCounts,
  type DepartmentRow,
} from '../services/departments.js';
import { findUserById, listUsers } from '../services/users.js';

/**
 * HOD routes. Every handler resolves the caller's department first and then
 * queries within it, so a department's classes, rosters and faculty
 * assignments are never visible from another department's account.
 */

export const hodRouter = Router();

hodRouter.use('/hod', requireAuth, requireRole('hod'));

const uuidParamSchema = z.object({ id: z.uuid('must be a valid id') });

const facultyAssignSchema = z.object({
  facultyUserId: z.uuid('must be a valid faculty id'),
});

/** The department headed by the caller; HOD accounts without one see nothing. */
async function requireHodDepartment(hodUserId: string): Promise<DepartmentRow> {
  const department = await findDepartmentHeadedBy(hodUserId);
  if (!department) {
    throw new ApiError(404, 'No department is assigned to your account yet.');
  }
  return department;
}

/** GET /api/hod/overview — department summary with classes and current faculty. */
hodRouter.get('/hod/overview', async (req, res) => {
  const department = await requireHodDepartment(authenticatedUserId(req));
  const [counts, classes] = await Promise.all([
    getDepartmentOverviewCounts(department.id),
    listClassesForDepartment(department.id),
  ]);
  res.json({
    department: { id: department.id, name: department.name, code: department.code },
    counts,
    classes,
  });
});

/** GET /api/hod/faculty — eligible faculty accounts (all active faculty). */
hodRouter.get('/hod/faculty', async (_req, res) => {
  res.json({ faculty: await listUsers({ role: 'faculty' }) });
});

/** GET /api/hod/classes/:id — one department class with assignment history. */
hodRouter.get('/hod/classes/:id', validateParams(uuidParamSchema), async (req, res) => {
  const { id } = req.params as { id: string };
  const department = await requireHodDepartment(authenticatedUserId(req));

  const classRow = await getClassForDepartment(id, department.id);
  if (!classRow) {
    throw new ApiError(404, 'Class not found.');
  }

  const [details, assignments] = await Promise.all([
    getClassDetails(id),
    listAssignmentsForClass(id),
  ]);
  if (!details) {
    throw new Error('hod: class details missing for an existing class');
  }
  res.json({ class: details, assignments });
});

/** POST /api/hod/classes/:id/faculty — assign a faculty member to the class. */
hodRouter.post(
  '/hod/classes/:id/faculty',
  validateParams(uuidParamSchema),
  validateBody(facultyAssignSchema),
  async (req, res) => {
    const { id } = req.params as { id: string };
    const { facultyUserId } = req.body as z.infer<typeof facultyAssignSchema>;
    const actorUserId = authenticatedUserId(req);

    const department = await requireHodDepartment(actorUserId);
    const classRow = await getClassForDepartment(id, department.id);
    if (!classRow) {
      throw new ApiError(404, 'Class not found.');
    }

    const faculty = await findUserById(facultyUserId);
    if (!faculty || faculty.role !== 'faculty') {
      throw new ApiError(400, 'Select an account with the faculty role.');
    }
    if (!faculty.isActive) {
      throw new ApiError(400, 'This faculty account is deactivated. Activate it first.');
    }

    const assignment = await withTransaction(async (client) => {
      const row = await createAssignment(id, facultyUserId, actorUserId, client).catch((error: unknown) =>
        throwIfUniqueViolation(
          error,
          { class_faculty_active_key: 'This faculty member is already assigned to this class.' },
          'This faculty member is already assigned to this class.',
        ),
      );
      await logAudit(
        {
          actorUserId,
          action: 'hod.faculty_assign',
          entityType: 'class_faculty',
          entityId: row.id,
          newValue: { classId: id, facultyUserId, facultyName: faculty.fullName },
          ip: req.ip ?? null,
        },
        client,
      );
      return row;
    });

    res.status(201).json({
      assignment: {
        id: assignment.id,
        classId: id,
        facultyUserId,
        fullName: faculty.fullName,
        email: faculty.email,
        assignedAt: assignment.assignedAt,
        unassignedAt: null,
      },
    });
  },
);

/** POST /api/hod/assignments/:id/end — end an active faculty assignment. */
hodRouter.post('/hod/assignments/:id/end', validateParams(uuidParamSchema), async (req, res) => {
  const { id } = req.params as { id: string };
  const actorUserId = authenticatedUserId(req);

  const department = await requireHodDepartment(actorUserId);
  const scope = await findAssignmentScope(id);
  if (!scope || scope.departmentId !== department.id) {
    throw new ApiError(404, 'Faculty assignment not found.');
  }
  if (scope.unassignedAt !== null) {
    throw new ApiError(409, 'This assignment has already ended.');
  }

  const ended = await withTransaction(async (client) => {
    const row = await endAssignment(id, client);
    if (!row) {
      throw new ApiError(409, 'This assignment has already ended.');
    }
    await logAudit(
      {
        actorUserId,
        action: 'hod.faculty_unassign',
        entityType: 'class_faculty',
        entityId: row.id,
        oldValue: { classId: row.classId, facultyUserId: row.facultyUserId, unassignedAt: null },
        newValue: { unassignedAt: row.unassignedAt },
        ip: req.ip ?? null,
      },
      client,
    );
    return row;
  });

  res.json({ assignment: ended });
});
