import { z } from 'zod';

/**
 * Shared field schemas so account and class rules stay identical across the
 * admin and faculty route families.
 */

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(320, 'must be at most 320 characters')
  .pipe(z.email('must be a valid email address'));

export const passwordSchema = z
  .string()
  .min(8, 'must be at least 8 characters')
  .max(200, 'must be at most 200 characters')
  .regex(/[A-Za-z]/, 'must include at least one letter')
  .regex(/\d/, 'must include at least one number');

export const fullNameSchema = z
  .string()
  .trim()
  .min(2, 'must be at least 2 characters')
  .max(120, 'must be at most 120 characters');

export const academicYearSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}$/, 'must look like 2026-27');
