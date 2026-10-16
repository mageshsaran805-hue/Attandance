export type UserRole = 'admin' | 'hod' | 'faculty' | 'student'

export interface AuthUser {
  id: string
  email: string
  fullName: string
  role: UserRole
}

/** Where each role lands after signing in. */
export const HOME_PATH_BY_ROLE: Record<UserRole, string> = {
  admin: '/admin',
  hod: '/hod',
  faculty: '/faculty',
  student: '/student',
}

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Administrator',
  hod: 'Head of Department',
  faculty: 'Faculty',
  student: 'Student',
}
