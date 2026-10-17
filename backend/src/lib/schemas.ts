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

export const registerNumberSchema = z
  .string()
  .trim()
  .min(2, 'must be at least 2 characters')
  .max(40, 'must be at most 40 characters')
  .regex(/^[A-Za-z0-9/._-]+$/, 'must contain only letters, digits or / . _ -');

export const sectionSchema = z
  .string()
  .trim()
  .min(1, 'must be at least 1 character')
  .max(10, 'must be at most 10 characters')
  .regex(/^[A-Za-z0-9 -]+$/, 'must contain only letters, digits, spaces or -');

export const phoneSchema = z
  .string()
  .trim()
  .min(7, 'must be at least 7 characters')
  .max(20, 'must be at most 20 characters')
  .regex(/^[0-9+()\- ]+$/, 'must contain only digits, spaces or + ( ) -');
