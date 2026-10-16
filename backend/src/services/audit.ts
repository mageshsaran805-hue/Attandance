import type { Pool, PoolClient } from 'pg';
import { env } from '../config/env.js';
import { getPool } from '../db/pool.js';

/**
 * Append-only audit logging for sensitive mutations.
 *
 * Pass a transaction client when the audit row must commit atomically with
 * the change it describes. Never log password hashes, plaintext OTPs or
 * session tokens here.
 */

export interface AuditEntry {
  /** null only for events with no authenticated actor (e.g. failed login). */
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  oldValue?: unknown;
  newValue?: unknown;
  ip?: string | null;
}

export async function logAudit(entry: AuditEntry, client?: Pool | PoolClient): Promise<void> {
  const db = client ?? getPool();
  await db.query(
    `INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, old_value, new_value, ip)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      entry.actorUserId,
      entry.action,
      entry.entityType,
      entry.entityId,
      entry.oldValue === undefined ? null : JSON.stringify(entry.oldValue),
      entry.newValue === undefined ? null : JSON.stringify(entry.newValue),
      entry.ip ?? null,
    ],
  );
}

// ----------------------------------------------------------------------------
// Reading the audit trail (Phase 5, administrator-only view)
// ----------------------------------------------------------------------------

export interface AuditListFilters {
  action?: string;
  entityType?: string;
  /** Substring match against the actor's email (case-insensitive). */
  actorEmail?: string;
  /** YYYY-MM-DD calendar dates in the college timezone. */
  from?: string;
  to?: string;
  page: number;
  limit: number;
}

export interface AuditListEntry {
  id: string;
  createdAt: string;
  /** null for events without an authenticated actor (e.g. failed logins). */
  actor: { id: string; fullName: string; email: string } | null;
  action: string;
  entityType: string;
  entityId: string;
  oldValue: unknown;
  newValue: unknown;
  ip: string | null;
}

export interface AuditListResult {
  entries: AuditListEntry[];
  total: number;
  page: number;
  limit: number;
}

interface DbAuditRow {
  id: string;
  created_at: Date | string;
  action: string;
  entity_type: string;
  entity_id: string;
  old_value: unknown;
  new_value: unknown;
  ip: string | null;
  actor_id: string | null;
  actor_full_name: string | null;
  actor_email: string | null;
}

/** Newest-first page of audit entries, with optional filters. */
export async function listAuditEntries(filters: AuditListFilters): Promise<AuditListResult> {
  const pool = getPool();
  const conditions: string[] = [];
  const values: unknown[] = [];
  const addValue = (value: unknown): string => {
    values.push(value);
    return `$${values.length}`;
  };

  const timeZone = env.APP_TIMEZONE;
  let timeZonePlaceholder: string | null = null;
  const addTimeZoneValue = (): string => {
    timeZonePlaceholder ??= addValue(timeZone);
    return timeZonePlaceholder;
  };

  if (filters.action) {
    conditions.push(`a.action = ${addValue(filters.action)}`);
  }
  if (filters.entityType) {
    conditions.push(`a.entity_type = ${addValue(filters.entityType)}`);
  }
  if (filters.actorEmail) {
    conditions.push(`u.email ILIKE ${addValue(`%${filters.actorEmail}%`)}`);
  }
  if (filters.from) {
    conditions.push(
      `(a.created_at AT TIME ZONE ${addTimeZoneValue()}::text)::date >= ${addValue(filters.from)}::date`,
    );
  }
  if (filters.to) {
    conditions.push(
      `(a.created_at AT TIME ZONE ${addTimeZoneValue()}::text)::date <= ${addValue(filters.to)}::date`,
    );
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countResult = await pool.query<{ total: number }>(
    `SELECT count(*)::int AS total
       FROM audit_log a
       LEFT JOIN users u ON u.id = a.actor_user_id
      ${where}`,
    values,
  );

  const limitPlaceholder = addValue(filters.limit);
  const offsetPlaceholder = addValue((filters.page - 1) * filters.limit);

  const { rows } = await pool.query<DbAuditRow>(
    `SELECT a.id, a.created_at, a.action, a.entity_type, a.entity_id,
            a.old_value, a.new_value, a.ip,
            u.id AS actor_id, u.full_name AS actor_full_name, u.email AS actor_email
       FROM audit_log a
       LEFT JOIN users u ON u.id = a.actor_user_id
      ${where}
      ORDER BY a.id DESC
      LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}`,
    values,
  );

  return {
    entries: rows.map((row) => ({
      id: row.id,
      createdAt: new Date(row.created_at).toISOString(),
      actor: row.actor_id
        ? { id: row.actor_id, fullName: row.actor_full_name ?? '', email: row.actor_email ?? '' }
        : null,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      oldValue: row.old_value,
      newValue: row.new_value,
      ip: row.ip,
    })),
    total: countResult.rows[0]?.total ?? 0,
    page: filters.page,
    limit: filters.limit,
  };
}

/** Distinct action names, for the audit filter dropdown. */
export async function listAuditActions(): Promise<string[]> {
  const { rows } = await getPool().query<{ action: string }>(
    'SELECT DISTINCT action FROM audit_log ORDER BY action',
  );
  return rows.map((row) => row.action);
}
