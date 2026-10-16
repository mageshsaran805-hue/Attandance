import type { UserRole } from './roles'

/**
 * Response shapes for the Phase 3 administration API. Kept in one place so
 * pages and components share exact types with the backend payloads.
 */

export interface DepartmentHodSummary {
  id: string
  fullName: string
  email: string
}

export interface Department {
  id: string
  name: string
  code: string
  hodUserId: string | null
  hod: DepartmentHodSummary | null
  classCount: number
  studentCount: number
}

export interface DepartmentSummary {
  id: string
  name: string
  code: string
}

export interface AdminUser {
  id: string
  email: string
  fullName: string
  role: UserRole
  isActive: boolean
  registerNumber: string | null
  phone: string | null
  createdAt: string
}

export interface ClassListEntry {
  id: string
  name: string
  academicYear: string
  department: DepartmentSummary
  studentCount: number
  facultyCount: number
}

export interface ClassDetails {
  id: string
  name: string
  academicYear: string
  department: DepartmentSummary
  studentCount: number
}

export interface ClassFacultySummary {
  id: string
  facultyUserId: string
  fullName: string
  email: string
  assignedAt: string
}

export interface HodClassEntry {
  id: string
  name: string
  academicYear: string
  studentCount: number
  faculty: ClassFacultySummary[]
}

export interface HodOverview {
  department: DepartmentSummary
  counts: { classes: number; students: number; faculty: number }
  classes: HodClassEntry[]
}

export interface AssignmentDetails {
  id: string
  classId: string
  facultyUserId: string
  fullName: string
  email: string
  assignedAt: string
  unassignedAt: string | null
}

export interface HodClassResponse {
  class: ClassDetails
  assignments: { active: AssignmentDetails[]; history: AssignmentDetails[] }
}

export interface RosterEntry {
  enrollmentId: string
  enrolledAt: string
  unenrolledAt: string | null
  student: {
    id: string
    fullName: string
    email: string
    isActive: boolean
    registerNumber: string | null
    phone: string | null
  }
}

export interface FacultyClassResponse {
  class: ClassDetails
  students: RosterEntry[]
  formerStudents: RosterEntry[]
}

export interface AdminOverview {
  counts: {
    departments: number
    classes: number
    accounts: { admins: number; hods: number; faculty: number; students: number }
    pendingRegistrations: number
  }
}

// ---------------------------------------------------------------------------
// Phase 4: attendance sessions, OTP self-marking and manual marks
// ---------------------------------------------------------------------------

export type SessionStatus = 'open' | 'closed'
export type AttendanceStatus = 'present' | 'absent'
export type MarkMethod = 'otp' | 'manual'

export interface AttendanceCounts {
  enrolled: number
  present: number
  absent: number
  pending: number
}

export interface AttendanceSessionSummary {
  id: string
  classId: string
  className: string
  sessionDate: string
  status: SessionStatus
  otpExpiresAt: string | null
  otpActive: boolean
  startedByUserId: string
  startedByName: string
  closedByUserId: string | null
  closedByName: string | null
  closedAt: string | null
  createdAt: string
  counts: AttendanceCounts
}

export interface SessionStudentAttendance {
  studentUserId: string
  fullName: string
  email: string
  isActive: boolean
  status: AttendanceStatus | null
  method: MarkMethod | null
  markedAt: string | null
  updatedAt: string | null
}

export interface FacultySessionsResponse {
  today: AttendanceSessionSummary | null
  recent: AttendanceSessionSummary[]
}

export interface FacultySessionResponse {
  session: AttendanceSessionSummary
  students: SessionStudentAttendance[]
}

export interface OpenSessionResponse {
  session: AttendanceSessionSummary
  otp: string
}

export interface RegenerateOtpResponse {
  otp: string
  expiresAt: string
}

export interface CloseSessionResponse {
  session: AttendanceSessionSummary
  absentAdded: number
}

export interface AttendanceRecord {
  id: string
  sessionId: string
  studentUserId: string
  status: AttendanceStatus
  method: MarkMethod
  markedByUserId: string | null
  markedAt: string
  updatedAt: string
}

export interface ManualMarkResponse {
  record: AttendanceRecord
}

export interface StudentMarkResponse {
  record: AttendanceRecord
}

export interface StudentTodayEntry {
  class: {
    id: string
    name: string
    academicYear: string
    department: DepartmentSummary
  }
  session: {
    id: string
    status: SessionStatus
    sessionDate: string
    otpActive: boolean
    otpExpiresAt: string | null
  } | null
  record: { status: AttendanceStatus; method: MarkMethod; markedAt: string } | null
}

export interface StudentTodayResponse {
  date: string
  classes: StudentTodayEntry[]
}

// ---------------------------------------------------------------------------
// Phase 5: reporting and audit views
// ---------------------------------------------------------------------------

export interface ReportTotals {
  /** Sessions of any status in the range. */
  sessions: number
  /** Closed sessions in the range: the basis for percentages. */
  settledSessions: number
  present: number
  absent: number
  /** null when the range contains no settled records. */
  percentage: number | null
}

export interface ReportSessionEntry {
  id: string
  sessionDate: string
  status: SessionStatus
  present: number
  absent: number
  pending: number
}

export interface ReportStudentEntry {
  studentUserId: string
  fullName: string
  email: string
  isActive: boolean
  present: number
  absent: number
  percentage: number | null
}

export interface ClassReport {
  class: ClassDetails
  from: string
  to: string
  totals: ReportTotals
  students: ReportStudentEntry[]
  sessions: ReportSessionEntry[]
}

export interface DepartmentReportClassEntry extends ReportTotals {
  classId: string
  className: string
  academicYear: string
  studentCount: number
}

export interface DepartmentReport {
  department: DepartmentSummary
  from: string
  to: string
  totals: ReportTotals
  classes: DepartmentReportClassEntry[]
}

export interface SystemReportDepartmentEntry extends ReportTotals {
  departmentId: string
  departmentName: string
  departmentCode: string
  classCount: number
  studentCount: number
}

export interface SystemReportClassEntry extends ReportTotals {
  classId: string
  className: string
  academicYear: string
  studentCount: number
  department: DepartmentSummary
}

export interface SystemReport {
  from: string
  to: string
  totals: ReportTotals
  departments: SystemReportDepartmentEntry[]
  classes: SystemReportClassEntry[]
}

export interface StudentHistoryEntry {
  sessionId: string
  classId: string
  className: string
  sessionDate: string
  sessionStatus: SessionStatus
  /** null while the session is open and the student has not marked yet. */
  status: AttendanceStatus | null
  method: MarkMethod | null
  markedAt: string | null
}

export interface StudentHistoryResponse {
  from: string
  to: string
  totals: ReportTotals
  sessions: StudentHistoryEntry[]
}

export interface AuditListEntry {
  id: string
  createdAt: string
  actor: { id: string; fullName: string; email: string } | null
  action: string
  entityType: string
  entityId: string
  oldValue: unknown
  newValue: unknown
  ip: string | null
}

export interface AuditListResponse {
  entries: AuditListEntry[]
  total: number
  page: number
  limit: number
}

export interface AuditActionsResponse {
  actions: string[]
}

// ---------------------------------------------------------------------------
// Phase 6: student self-registration and the admin review queue
// ---------------------------------------------------------------------------

export type RegistrationStatus = 'pending' | 'approved' | 'rejected'

export interface RegistrationClassChoice {
  id: string
  name: string
  academicYear: string
}

export interface RegistrationDepartmentChoice {
  id: string
  name: string
  code: string
  classes: RegistrationClassChoice[]
}

export interface RegistrationChoicesResponse {
  departments: RegistrationDepartmentChoice[]
}

export interface SubmittedRegistration {
  id: string
  status: RegistrationStatus
  submittedAt: string
}

export interface AdminRegistrationEntry {
  id: string
  fullName: string
  email: string
  registerNumber: string
  phone: string | null
  status: RegistrationStatus
  submittedAt: string
  reviewedAt: string | null
  reviewedBy: { fullName: string; email: string } | null
  createdUser: { id: string; email: string } | null
  class: {
    id: string
    name: string
    academicYear: string
    department: DepartmentSummary
  }
}

export interface AdminRegistrationsResponse {
  items: AdminRegistrationEntry[]
  total: number
  page: number
  limit: number
}

export interface RegistrationReviewResponse {
  results: Array<{ id: string; ok: boolean; error?: string }>
  approved?: number
  rejected?: number
  failed: number
}
