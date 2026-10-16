import { Router } from 'express';
import { z } from 'zod';
import { withTransaction } from '../db/transactions.js';
import { ApiError } from '../lib/errors.js';
import { hashPassword } from '../lib/password.js';
import { throwIfUniqueViolation } from '../lib/pg-errors.js';
import { academicYearSchema, emailSchema, fullNameSchema, passwordSchema } from '../lib/schemas.js';
import { authenticatedUserId, requireAuth, requireRole } from '../middleware/auth.js';
import { validateBody, validateParams, parseQuery } from '../middleware/validate.js';
import { listAuditActions, listAuditEntries, logAudit } from '../services/audit.js';
import { countActiveAssignmentsForFaculty } from '../services/class-faculty.js';
import {
  countClasses,
  createClass,
  getClassById,
  getClassDetails,
  listClassesWithDetails,
  updateClass,
} from '../services/classes.js';
import {
  countDepartments,
  createDepartment,
  findDepartmentHeadedBy,
  getDepartmentById,
  getDepartmentWithDetails,
  listDepartments,
  setDepartmentHod,
  updateDepartment,
} from '../services/departments.js';
import { countActiveEnrollmentsForStudent } from '../services/enrollments.js';
import {
  createUser,
  findUserById,
  getActiveAccountCounts,
  listUsers,
  setUserActive,
  setUserPassword,
  setUserRole,
  updateUserProfile,
} from '../services/users.js';

/**
 * Administrator routes: departments, classes, and every account family.
 *
 * All mutations are audit-logged with before/after snapshots (never passwords)
 * and reference checks keep role-bound data consistent (an HOD who still heads
 * a department cannot be demoted, an actively enrolled student cannot change
 * role, and so on).
 */

export const adminRouter = Router();

// Every /api/admin route is administrator-only.
adminRouter.use('/admin', requireAuth, requireRole('admin'));

const uuidParamSchema = z.object({ id: z.uuid('must be a valid id') });

const departmentCreateSchema = z.object({
  name: z.string().trim().min(2, 'must be at least 2 characters').max(100, 'must be at most 100 characters'),
  code: z
    .string()
    .trim()
    .min(2, 'must be at least 2 characters')
    .max(10, 'must be at most 10 characters')
    .regex(/^[A-Za-z0-9]+$/, 'must contain only letters and digits')
    .transform((value) => value.toUpperCase()),
});

const departmentUpdateSchema = z
  .object({
    name: z.string().trim().min(2, 'must be at least 2 characters').max(100, 'must be at most 100 characters').optional(),
    code: z
      .string()
      .trim()
      .min(2, 'must be at least 2 characters')
      .max(10, 'must be at most 10 characters')
      .regex(/^[A-Za-z0-9]+$/, 'must contain only letters and digits')
      .transform((value) => value.toUpperCase())
      .optional(),
  })
  .refine((value) => value.name !== undefined || value.code !== undefined, {
    message: 'provide name and/or code',
  });

const hodAssignSchema = z.object({
  hodUserId: z.uuid('must be a valid user id').nullable(),
});

const userCreateSchema = z.object({
  fullName: fullNameSchema,
  email: emailSchema,
  role: z.enum(['admin', 'hod', 'faculty']),
  password: passwordSchema,
});

const userUpdateSchema = z
  .object({
    fullName: fullNameSchema.optional(),
    email: emailSchema.optional(),
  })
  .refine((value) => value.fullName !== undefined || value.email !== undefined, {
    message: 'provide fullName and/or email',
  });

const userStatusSchema = z.object({ isActive: z.boolean() });

const userRoleSchema = z.object({ role: z.enum(['admin', 'hod', 'faculty', 'student']) });

const passwordResetSchema = z.object({ newPassword: passwordSchema });

const userListQuerySchema = z.object({
  role: z.enum(['admin', 'hod', 'faculty', 'student']).optional(),
  search: z.string().trim().max(100, 'must be at most 100 characters').optional(),
  includeInactive: z.enum(['true', 'false', '1', '0']).optional(),
});

const classCreateSchema = z.object({
  departmentId: z.uuid('must be a valid department id'),
  name: z.string().trim().min(2, 'must be at least 2 characters').max(120, 'must be at most 120 characters'),
  academicYear: academicYearSchema,
});

const classUpdateSchema = z
  .object({
    name: z.string().trim().min(2, 'must be at least 2 characters').max(120, 'must be at most 120 characters').optional(),
    academicYear: academicYearSchema.optional(),
  })
  .refine((value) => value.name !== undefined || value.academicYear !== undefined, {
    message: 'provide name and/or academicYear',
  });

const DEPARTMENT_UNIQUE_MESSAGES: Record<string, string> = {
  departments_name_key: 'A department with this name already exists.',
  departments_code_key: 'A department with this code already exists.',
};

const USER_EMAIL_UNIQUE_MESSAGES: Record<string, string> = {
  users_email_lower_key: 'An account with this email already exists.',
};

const CLASS_IDENTITY_UNIQUE_MESSAGES: Record<string, string> = {
  classes_identity_key:
    'A class with this name already exists in this department for this academic year.',
};

/** GET /api/admin/overview — headline counts for the admin dashboard. */
adminRouter.get('/admin/overview', async (_req, res) => {
  const [departments, classes, accounts] = await Promise.all([
    countDepartments(),
    countClasses(),
    getActiveAccountCounts(),
  ]);
  res.json({ counts: { departments, classes, accounts } });
});

/** GET /api/admin/departments — departments with their HOD and usage counts. */
adminRouter.get('/admin/departments', async (_req, res) => {
  res.json({ departments: await listDepartments() });
});

/** POST /api/admin/departments — create a department. */
adminRouter.post('/admin/departments', validateBody(departmentCreateSchema), async (req, res) => {
  const input = req.body as z.infer<typeof departmentCreateSchema>;
  const actorUserId = authenticatedUserId(req);

  const created = await withTransaction(async (client) => {
    const row = await createDepartment(input, client).catch((error: unknown) =>
      throwIfUniqueViolation(error, DEPARTMENT_UNIQUE_MESSAGES, 'A department with these details already exists.'),
    );
    await logAudit(
      {
        actorUserId,
        action: 'admin.department_create',
        entityType: 'department',
        entityId: row.id,
        newValue: { name: row.name, code: row.code },
        ip: req.ip ?? null,
      },
      client,
    );
    return row;
  });

  const department = await getDepartmentWithDetails(created.id);
  if (!department) {
    throw new Error('admin: department details missing right after create');
  }
  res.status(201).json({ department });
});

/** PATCH /api/admin/departments/:id — rename or recode a department. */
adminRouter.patch(
  '/admin/departments/:id',
  validateParams(uuidParamSchema),
  validateBody(departmentUpdateSchema),
  async (req, res) => {
    const { id } = req.params as { id: string };
    const input = req.body as z.infer<typeof departmentUpdateSchema>;
    const actorUserId = authenticatedUserId(req);

    const current = await getDepartmentById(id);
    if (!current) {
      throw new ApiError(404, 'Department not found.');
    }

    const updated = await withTransaction(async (client) => {
      const row = await updateDepartment(
        id,
        { name: input.name ?? current.name, code: input.code ?? current.code },
        client,
      ).catch((error: unknown) =>
        throwIfUniqueViolation(error, DEPARTMENT_UNIQUE_MESSAGES, 'A department with these details already exists.'),
      );
      if (!row) {
        throw new ApiError(404, 'Department not found.');
      }
      await logAudit(
        {
          actorUserId,
          action: 'admin.department_update',
          entityType: 'department',
          entityId: id,
          oldValue: { name: current.name, code: current.code },
          newValue: { name: row.name, code: row.code },
          ip: req.ip ?? null,
        },
        client,
      );
      return row;
    });

    const department = await getDepartmentWithDetails(updated.id);
    if (!department) {
      throw new Error('admin: department details missing right after update');
    }
    res.json({ department });
  },
);

/**
 * PUT /api/admin/departments/:id/hod — assign or clear the department's HOD.
 * Strict 1:1: an HOD who already heads another department is rejected.
 */
adminRouter.put(
  '/admin/departments/:id/hod',
  validateParams(uuidParamSchema),
  validateBody(hodAssignSchema),
  async (req, res) => {
    const { id } = req.params as { id: string };
    const { hodUserId } = req.body as z.infer<typeof hodAssignSchema>;
    const actorUserId = authenticatedUserId(req);

    const current = await getDepartmentById(id);
    if (!current) {
      throw new ApiError(404, 'Department not found.');
    }

    if (hodUserId !== null) {
      const hod = await findUserById(hodUserId);
      if (!hod || hod.role !== 'hod') {
        throw new ApiError(400, 'Select an account with the HOD role.');
      }
      if (!hod.isActive) {
        throw new ApiError(400, 'This account is deactivated. Activate it first.');
      }
      const otherDepartment = await findDepartmentHeadedBy(hodUserId);
      if (otherDepartment && otherDepartment.id !== id) {
        throw new ApiError(
          409,
          `This HOD already heads ${otherDepartment.name}. Reassign that department first.`,
        );
      }
    }

    const updated = await withTransaction(async (client) => {
      const row = await setDepartmentHod(id, hodUserId, client).catch((error: unknown) =>
        throwIfUniqueViolation(
          error,
          { departments_hod_user_id_key: 'This HOD already heads another department.' },
          'This HOD already heads another department.',
        ),
      );
      if (!row) {
        throw new ApiError(404, 'Department not found.');
      }
      await logAudit(
        {
          actorUserId,
          action: 'admin.department_hod_assign',
          entityType: 'department',
          entityId: id,
          oldValue: { hodUserId: current.hodUserId },
          newValue: { hodUserId: row.hodUserId },
          ip: req.ip ?? null,
        },
        client,
      );
      return row;
    });

    const department = await getDepartmentWithDetails(updated.id);
    if (!department) {
      throw new Error('admin: department details missing right after HOD change');
    }
    res.json({ department });
  },
);

/** GET /api/admin/users — account list with optional role/search filters. */
adminRouter.get('/admin/users', async (req, res) => {
  const parsed = userListQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid query parameters' });
    return;
  }
  const { role, search, includeInactive } = parsed.data;
  const users = await listUsers({
    role,
    search,
    includeInactive: includeInactive === 'true' || includeInactive === '1',
  });
  res.json({ users });
});

/** POST /api/admin/users — create an admin, HOD or faculty account. */
adminRouter.post('/admin/users', validateBody(userCreateSchema), async (req, res) => {
  const input = req.body as z.infer<typeof userCreateSchema>;
  const actorUserId = authenticatedUserId(req);
  const passwordHash = await hashPassword(input.password);

  const created = await withTransaction(async (client) => {
    const row = await createUser(
      { email: input.email, fullName: input.fullName, role: input.role, passwordHash },
      client,
    ).catch((error: unknown) =>
      throwIfUniqueViolation(error, USER_EMAIL_UNIQUE_MESSAGES, 'An account with this email already exists.'),
    );
    await logAudit(
      {
        actorUserId,
        action: 'admin.user_create',
        entityType: 'user',
        entityId: row.id,
        newValue: { email: row.email, fullName: row.fullName, role: row.role },
        ip: req.ip ?? null,
      },
      client,
    );
    return row;
  });

  res.status(201).json({ user: created });
});

/** PATCH /api/admin/users/:id — update name and/or email. */
adminRouter.patch(
  '/admin/users/:id',
  validateParams(uuidParamSchema),
  validateBody(userUpdateSchema),
  async (req, res) => {
    const { id } = req.params as { id: string };
    const input = req.body as z.infer<typeof userUpdateSchema>;
    const actorUserId = authenticatedUserId(req);

    const current = await findUserById(id);
    if (!current) {
      throw new ApiError(404, 'Account not found.');
    }

    const updated = await withTransaction(async (client) => {
      const row = await updateUserProfile(
        id,
        { fullName: input.fullName ?? current.fullName, email: input.email ?? current.email },
        client,
      ).catch((error: unknown) =>
        throwIfUniqueViolation(error, USER_EMAIL_UNIQUE_MESSAGES, 'An account with this email already exists.'),
      );
      if (!row) {
        throw new ApiError(404, 'Account not found.');
      }
      await logAudit(
        {
          actorUserId,
          action: 'admin.user_update',
          entityType: 'user',
          entityId: id,
          oldValue: { fullName: current.fullName, email: current.email },
          newValue: { fullName: row.fullName, email: row.email },
          ip: req.ip ?? null,
        },
        client,
      );
      return row;
    });

    res.json({ user: updated });
  },
);

/** POST /api/admin/users/:id/status — activate or deactivate an account. */
adminRouter.post(
  '/admin/users/:id/status',
  validateParams(uuidParamSchema),
  validateBody(userStatusSchema),
  async (req, res) => {
    const { id } = req.params as { id: string };
    const { isActive } = req.body as z.infer<typeof userStatusSchema>;
    const actorUserId = authenticatedUserId(req);

    const current = await findUserById(id);
    if (!current) {
      throw new ApiError(404, 'Account not found.');
    }
    if (!isActive && id === actorUserId) {
      throw new ApiError(400, 'You cannot deactivate your own account.');
    }

    const updated = await withTransaction(async (client) => {
      const row = await setUserActive(id, isActive, client);
      if (!row) {
        throw new ApiError(404, 'Account not found.');
      }
      await logAudit(
        {
          actorUserId,
          action: 'admin.user_status',
          entityType: 'user',
          entityId: id,
          oldValue: { isActive: current.isActive },
          newValue: { isActive: row.isActive },
          ip: req.ip ?? null,
        },
        client,
      );
      return row;
    });

    res.json({ user: updated });
  },
);

/**
 * POST /api/admin/users/:id/role — change a role.
 * Rejected while the account still holds active role-bound records, so the
 * 1:1 HOD rule, class rosters and faculty assignments stay consistent.
 */
adminRouter.post(
  '/admin/users/:id/role',
  validateParams(uuidParamSchema),
  validateBody(userRoleSchema),
  async (req, res) => {
    const { id } = req.params as { id: string };
    const { role } = req.body as z.infer<typeof userRoleSchema>;
    const actorUserId = authenticatedUserId(req);

    const current = await findUserById(id);
    if (!current) {
      throw new ApiError(404, 'Account not found.');
    }
    if (id === actorUserId) {
      throw new ApiError(400, 'You cannot change your own role.');
    }
    if (role === current.role) {
      res.json({ user: current });
      return;
    }

    if (current.role === 'student') {
      const active = await countActiveEnrollmentsForStudent(id);
      if (active > 0) {
        throw new ApiError(
          409,
          `This student is actively enrolled in ${active} class(es). Unenroll them first.`,
        );
      }
    } else if (current.role === 'faculty') {
      const active = await countActiveAssignmentsForFaculty(id);
      if (active > 0) {
        throw new ApiError(
          409,
          `This faculty member is actively assigned to ${active} class(es). Remove those assignments first.`,
        );
      }
    } else if (current.role === 'hod') {
      const department = await findDepartmentHeadedBy(id);
      if (department) {
        throw new ApiError(
          409,
          `This HOD heads the ${department.name} department. Assign a different HOD first.`,
        );
      }
    }

    const updated = await withTransaction(async (client) => {
      const row = await setUserRole(id, role, client);
      if (!row) {
        throw new ApiError(404, 'Account not found.');
      }
      await logAudit(
        {
          actorUserId,
          action: 'admin.user_role_change',
          entityType: 'user',
          entityId: id,
          oldValue: { role: current.role },
          newValue: { role: row.role },
          ip: req.ip ?? null,
        },
        client,
      );
      return row;
    });

    res.json({ user: updated });
  },
);

/** POST /api/admin/users/:id/reset-password — administrative password reset. */
adminRouter.post(
  '/admin/users/:id/reset-password',
  validateParams(uuidParamSchema),
  validateBody(passwordResetSchema),
  async (req, res) => {
    const { id } = req.params as { id: string };
    const { newPassword } = req.body as z.infer<typeof passwordResetSchema>;
    const actorUserId = authenticatedUserId(req);

    const current = await findUserById(id);
    if (!current) {
      throw new ApiError(404, 'Account not found.');
    }

    const passwordHash = await hashPassword(newPassword);
    await withTransaction(async (client) => {
      await setUserPassword(id, passwordHash, client);
      await logAudit(
        {
          actorUserId,
          action: 'admin.user_password_reset',
          entityType: 'user',
          entityId: id,
          newValue: { email: current.email },
          ip: req.ip ?? null,
        },
        client,
      );
    });

    res.status(204).end();
  },
);

/** GET /api/admin/classes — all classes with department and roster counts. */
adminRouter.get('/admin/classes', async (_req, res) => {
  res.json({ classes: await listClassesWithDetails() });
});

/** POST /api/admin/classes — create a class inside a department. */
adminRouter.post('/admin/classes', validateBody(classCreateSchema), async (req, res) => {
  const input = req.body as z.infer<typeof classCreateSchema>;
  const actorUserId = authenticatedUserId(req);

  const department = await getDepartmentById(input.departmentId);
  if (!department) {
    throw new ApiError(400, 'Select an existing department.');
  }

  const created = await withTransaction(async (client) => {
    const row = await createClass(input, client).catch((error: unknown) =>
      throwIfUniqueViolation(error, CLASS_IDENTITY_UNIQUE_MESSAGES, 'A class with these details already exists.'),
    );
    await logAudit(
      {
        actorUserId,
        action: 'admin.class_create',
        entityType: 'class',
        entityId: row.id,
        newValue: { departmentId: row.departmentId, name: row.name, academicYear: row.academicYear },
        ip: req.ip ?? null,
      },
      client,
    );
    return row;
  });

  const details = await getClassDetails(created.id);
  if (!details) {
    throw new Error('admin: class details missing right after create');
  }
  res.status(201).json({ class: details });
});

/** PATCH /api/admin/classes/:id — rename a class or change its academic year. */
adminRouter.patch(
  '/admin/classes/:id',
  validateParams(uuidParamSchema),
  validateBody(classUpdateSchema),
  async (req, res) => {
    const { id } = req.params as { id: string };
    const input = req.body as z.infer<typeof classUpdateSchema>;
    const actorUserId = authenticatedUserId(req);

    const current = await getClassById(id);
    if (!current) {
      throw new ApiError(404, 'Class not found.');
    }

    const updated = await withTransaction(async (client) => {
      const row = await updateClass(
        id,
        { name: input.name ?? current.name, academicYear: input.academicYear ?? current.academicYear },
        client,
      ).catch((error: unknown) =>
        throwIfUniqueViolation(error, CLASS_IDENTITY_UNIQUE_MESSAGES, 'A class with these details already exists.'),
      );
      if (!row) {
        throw new ApiError(404, 'Class not found.');
      }
      await logAudit(
        {
          actorUserId,
          action: 'admin.class_update',
          entityType: 'class',
          entityId: id,
          oldValue: { name: current.name, academicYear: current.academicYear },
          newValue: { name: row.name, academicYear: row.academicYear },
          ip: req.ip ?? null,
        },
        client,
      );
      return row;
    });

    const details = await getClassDetails(updated.id);
    if (!details) {
      throw new Error('admin: class details missing right after update');
    }
    res.json({ class: details });
  },
);

// ----------------------------------------------------------------------------
// Audit trail view (Phase 5, administrator-only)
// ----------------------------------------------------------------------------

const emptyToUndefined = (value: unknown) => (value === '' ? undefined : value);

const auditListQuerySchema = z.object({
  action: z.preprocess(emptyToUndefined, z.string().trim().max(100).optional()),
  entityType: z.preprocess(emptyToUndefined, z.string().trim().max(100).optional()),
  actorEmail: z.preprocess(emptyToUndefined, z.string().trim().max(320).optional()),
  from: z.preprocess(emptyToUndefined, z.iso.date().optional()),
  to: z.preprocess(emptyToUndefined, z.iso.date().optional()),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

/** GET /api/admin/audit — newest-first audit log with filters and paging. */
adminRouter.get('/admin/audit', async (req, res) => {
  const query = parseQuery(req.query, auditListQuerySchema);
  if (query.from && query.to && query.from > query.to) {
    throw new ApiError(400, 'Invalid range: "from" must not be after "to".');
  }
  res.json(
    await listAuditEntries({
      action: query.action,
      entityType: query.entityType,
      actorEmail: query.actorEmail,
      from: query.from,
      to: query.to,
      page: query.page,
      limit: query.limit,
    }),
  );
});

/** GET /api/admin/audit/actions — distinct action names for the filter UI. */
adminRouter.get('/admin/audit/actions', async (_req, res) => {
  res.json({ actions: await listAuditActions() });
});
