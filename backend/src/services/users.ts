import type { Pool, PoolClient } from 'pg';
import { getPool } from '../db/pool.js';
import { expectRow } from '../lib/errors.js';

export type UserRole = 'admin' | 'hod' | 'faculty' | 'student';

export interface UserRow {
  id: string;
  email: string;
  fullName: string;
  passwordHash: string;
  role: UserRole;
  isActive: boolean;
}

interface DbUserRow {
  id: string;
  email: string;
  full_name: string;
  password_hash: string;
  role: UserRole;
  is_active: boolean;
}

const USER_COLUMNS = 'id, email, full_name, password_hash, role, is_active';

function mapUser(row: DbUserRow): UserRow {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    passwordHash: row.password_hash,
    role: row.role,
    isActive: row.is_active,
  };
}

export async function findUserByEmail(email: string): Promise<UserRow | null> {
  const { rows } = await getPool().query<DbUserRow>(
    `SELECT ${USER_COLUMNS} FROM users WHERE lower(email) = lower($1) LIMIT 1`,
    [email],
  );
  const row = rows[0];
  return row ? mapUser(row) : null;
}

/**
 * Loads an active account by id. Deactivated accounts return null, which
 * invalidates their existing sessions immediately.
 */
export async function findActiveUserById(id: string): Promise<UserRow | null> {
  const { rows } = await getPool().query<DbUserRow>(
    `SELECT ${USER_COLUMNS} FROM users WHERE id = $1 AND is_active LIMIT 1`,
    [id],
  );
  const row = rows[0];
  return row ? mapUser(row) : null;
}

// ---------------------------------------------------------------------------
// Account administration
// ---------------------------------------------------------------------------

/** Admin-facing view of an account; never includes the password hash. */
export interface AdminUserRow {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  isActive: boolean;
  /** Student profile fields; null for staff accounts. */
  registerNumber: string | null;
  phone: string | null;
  createdAt: string;
}

export interface UserListFilters {
  role?: UserRole;
  search?: string;
  includeInactive?: boolean;
}

interface DbAdminUserRow {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  is_active: boolean;
  register_number: string | null;
  phone: string | null;
  created_at: string;
}

const ADMIN_USER_COLUMNS =
  'id, email, full_name, role, is_active, register_number, phone, created_at';

function mapAdminUser(row: DbAdminUserRow): AdminUserRow {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    role: row.role,
    isActive: row.is_active,
    registerNumber: row.register_number,
    phone: row.phone,
    createdAt: row.created_at,
  };
}

export async function listUsers(
  filters: UserListFilters,
  client?: Pool | PoolClient,
): Promise<AdminUserRow[]> {
  const db = client ?? getPool();
  const term = filters.search?.trim();
  // Escape LIKE wildcards so a search for "100%" is a literal substring match.
  const pattern = term ? `%${term.replace(/[\\%_]/g, '\\$&')}%` : null;
  const { rows } = await db.query<DbAdminUserRow>(
    `SELECT ${ADMIN_USER_COLUMNS}
       FROM users
      WHERE ($1::user_role IS NULL OR role = $1)
        AND ($2::text IS NULL OR full_name ILIKE $2 OR email ILIKE $2)
        AND ($3::boolean OR is_active)
      ORDER BY full_name
      LIMIT 500`,
    [filters.role ?? null, pattern, filters.includeInactive === true],
  );
  return rows.map(mapAdminUser);
}

export async function findUserById(
  id: string,
  client?: Pool | PoolClient,
): Promise<AdminUserRow | null> {
  const db = client ?? getPool();
  const { rows } = await db.query<DbAdminUserRow>(
    `SELECT ${ADMIN_USER_COLUMNS} FROM users WHERE id = $1`,
    [id],
  );
  const row = rows[0];
  return row ? mapAdminUser(row) : null;
}

export async function createUser(
  input: {
    email: string;
    fullName: string;
    role: UserRole;
    passwordHash: string;
    registerNumber?: string | null;
    phone?: string | null;
  },
  client?: Pool | PoolClient,
): Promise<AdminUserRow> {
  const db = client ?? getPool();
  const { rows } = await db.query<DbAdminUserRow>(
    `INSERT INTO users (email, full_name, role, password_hash, register_number, phone)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING ${ADMIN_USER_COLUMNS}`,
    [
      input.email,
      input.fullName,
      input.role,
      input.passwordHash,
      input.registerNumber ?? null,
      input.phone ?? null,
    ],
  );
  return mapAdminUser(expectRow(rows[0], 'users: insert'));
}

/**
 * Updates profile fields. Register number and phone are only changed when a
 * value is provided (COALESCE): clearing them is not supported yet, and
 * callers that do not manage them (e.g. admin name/email edits) keep them.
 */
export async function updateUserProfile(
  id: string,
  input: { fullName: string; email: string; registerNumber?: string | null; phone?: string | null },
  client?: Pool | PoolClient,
): Promise<AdminUserRow | null> {
  const db = client ?? getPool();
  const { rows } = await db.query<DbAdminUserRow>(
    `UPDATE users
        SET full_name = $2,
            email = $3,
            register_number = COALESCE($4, register_number),
            phone = COALESCE($5, phone)
      WHERE id = $1
      RETURNING ${ADMIN_USER_COLUMNS}`,
    [id, input.fullName, input.email, input.registerNumber ?? null, input.phone ?? null],
  );
  const row = rows[0];
  return row ? mapAdminUser(row) : null;
}

export async function setUserActive(
  id: string,
  isActive: boolean,
  client?: Pool | PoolClient,
): Promise<AdminUserRow | null> {
  const db = client ?? getPool();
  const { rows } = await db.query<DbAdminUserRow>(
    `UPDATE users SET is_active = $2 WHERE id = $1 RETURNING ${ADMIN_USER_COLUMNS}`,
    [id, isActive],
  );
  const row = rows[0];
  return row ? mapAdminUser(row) : null;
}

export async function setUserRole(
  id: string,
  role: UserRole,
  client?: Pool | PoolClient,
): Promise<AdminUserRow | null> {
  const db = client ?? getPool();
  const { rows } = await db.query<DbAdminUserRow>(
    `UPDATE users SET role = $2 WHERE id = $1 RETURNING ${ADMIN_USER_COLUMNS}`,
    [id, role],
  );
  const row = rows[0];
  return row ? mapAdminUser(row) : null;
}

/** Administrative password reset; returns false when the account is gone. */
export async function setUserPassword(
  id: string,
  passwordHash: string,
  client?: Pool | PoolClient,
): Promise<boolean> {
  const db = client ?? getPool();
  const { rowCount } = await db.query('UPDATE users SET password_hash = $2 WHERE id = $1', [
    id,
    passwordHash,
  ]);
  return rowCount === 1;
}

export interface ActiveAccountCounts {
  admins: number;
  hods: number;
  faculty: number;
  students: number;
}

export async function getActiveAccountCounts(
  client?: Pool | PoolClient,
): Promise<ActiveAccountCounts> {
  const db = client ?? getPool();
  const { rows } = await db.query<ActiveAccountCounts>(
    `SELECT count(*) FILTER (WHERE role = 'admin')::int   AS admins,
            count(*) FILTER (WHERE role = 'hod')::int     AS hods,
            count(*) FILTER (WHERE role = 'faculty')::int AS faculty,
            count(*) FILTER (WHERE role = 'student')::int AS students
       FROM users
      WHERE is_active`,
  );
  return expectRow(rows[0], 'users: account counts');
}
