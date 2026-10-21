import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { withTransaction } from '../db/transactions.js';
import { ApiError } from '../lib/errors.js';
import { hashPassword } from '../lib/password.js';
import { throwIfUniqueViolation } from '../lib/pg-errors.js';
import {
  emailSchema,
  fullNameSchema,
  passwordSchema,
  phoneSchema,
  registerNumberSchema,
} from '../lib/schemas.js';
import { validateBody } from '../middleware/validate.js';
import { logAudit } from '../services/audit.js';
import { getClassById, listDepartmentsWithClasses } from '../services/classes.js';
import { createRegistration } from '../services/registrations.js';
import { findUserByEmail } from '../services/users.js';

/**
 * Public student self-registration (no session required).
 *
 * Submissions are requests only: nothing here creates a `users` row — an
 * administrator reviews the queue and approving creates + enrolls the
 * account. The rate limit is a coarse spam guard (behind the free-tier proxy
 * chain req.ip may be a CDN address, see docs/deployment-free.md); the real
 * duplicate guard is the partial unique index on pending email / register
 * number.
 */

export const registrationRouter = Router();

const registrationRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1_000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (_req, res) => {
    res
      .status(429)
      .json({ error: 'Too many registration attempts. Please try again in a few minutes.' });
  },
});

const registerSchema = z.object({
  fullName: fullNameSchema,
  email: emailSchema,
  registerNumber: registerNumberSchema,
  phone: phoneSchema.optional(),
  classId: z.uuid('must be a valid class id'),
  password: passwordSchema,
});

/** GET /api/registration/classes — departments and classes anyone can choose from. */
registrationRouter.get('/registration/classes', async (_req, res) => {
  res.json({ departments: await listDepartmentsWithClasses() });
});

/** POST /api/registration — submit a registration request for review. */
registrationRouter.post(
  '/registration',
  registrationRateLimiter,
  validateBody(registerSchema),
  async (req, res) => {
    const input = req.body as z.infer<typeof registerSchema>;

    const existing = await findUserByEmail(input.email);
    if (existing) {
      throw new ApiError(
        409,
        'An account with this email address already exists. Sign in instead.',
      );
    }

    const classRow = await getClassById(input.classId);
    if (!classRow) {
      throw new ApiError(400, 'The selected class is no longer available. Please pick another one.');
    }

    const passwordHash = await hashPassword(input.password);
    const created = await withTransaction(async (client) => {
      const row = await createRegistration(
        {
          fullName: input.fullName,
          email: input.email,
          registerNumber: input.registerNumber,
          phone: input.phone ?? null,
          section: null,
          classId: input.classId,
          passwordHash,
        },
        client,
      ).catch((error: unknown) =>
        throwIfUniqueViolation(
          error,
          {
            student_registrations_pending_email_key:
              'A registration with this email address is already waiting for review.',
            student_registrations_pending_register_number_key:
              'A registration with this register number is already waiting for review.',
          },
          'A registration with these details is already waiting for review.',
        ),
      );
      await logAudit(
        {
          actorUserId: null,
          action: 'registration.submit',
          entityType: 'student_registration',
          entityId: row.id,
          newValue: {
            email: row.email,
            fullName: row.fullName,
            registerNumber: row.registerNumber,
            classId: row.classId,
          },
          ip: req.ip ?? null,
        },
        client,
      );
      return row;
    });

    res.status(201).json({
      registration: { id: created.id, status: created.status, submittedAt: created.submittedAt },
    });
  },
);
