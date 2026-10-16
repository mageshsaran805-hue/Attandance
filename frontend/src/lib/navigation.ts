import type { UserRole } from './roles'

export interface NavItem {
  to: string
  label: string
  /** True for index routes so deeper paths do not keep the item active. */
  end?: boolean
}

/**
 * Side navigation per role. Sub-pages (class details, rosters) are reached
 * from the lists, so each role only needs its top-level entries here.
 */
export const NAV_BY_ROLE: Record<UserRole, NavItem[]> = {
  admin: [
    { to: '/admin', label: 'Overview', end: true },
    { to: '/admin/departments', label: 'Departments' },
    { to: '/admin/classes', label: 'Classes' },
    { to: '/admin/users', label: 'Accounts' },
    { to: '/admin/reports', label: 'Reports' },
    { to: '/admin/audit', label: 'Audit log' },
  ],
  hod: [
    { to: '/hod', label: 'Department overview', end: true },
    { to: '/hod/reports', label: 'Reports' },
  ],
  faculty: [{ to: '/faculty', label: 'My classes', end: true }],
  student: [{ to: '/student', label: 'My attendance', end: true }],
}
