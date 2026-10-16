import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import AppShell from '../../components/AppShell'
import Alert from '../../components/ui/Alert'
import Badge from '../../components/ui/Badge'
import Button from '../../components/ui/Button'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import { TextField } from '../../components/ui/FormField'
import Modal from '../../components/ui/Modal'
import PageHeader from '../../components/ui/PageHeader'
import { Table, Td, Th } from '../../components/ui/Table'
import { apiFetch } from '../../lib/api'
import type {
  FacultyClassResponse,
  FacultySessionsResponse,
  OpenSessionResponse,
  RosterEntry,
} from '../../lib/api-types'
import { storeSessionOtp } from '../../lib/attendance'
import { formatDate, formatTime } from '../../lib/format'
import { useAction } from '../../lib/forms'
import { useFetch } from '../../lib/use-fetch'

type Flash = { tone: 'success' | 'error'; text: string }

/**
 * One assigned class: the active roster plus former students, with student
 * account creation, enrolling existing student accounts, edits, password
 * resets and unenrolling. Unenrolling keeps history; re-enrolling the same
 * student creates a fresh enrollment row.
 */
export default function FacultyClassPage() {
  const { classId } = useParams<{ classId: string }>()
  const navigate = useNavigate()
  const detail = useFetch<FacultyClassResponse>(classId ? `/api/faculty/classes/${classId}` : null)
  const attendance = useFetch<FacultySessionsResponse>(
    classId ? `/api/faculty/classes/${classId}/sessions` : null,
  )
  const [flash, setFlash] = useState<Flash | null>(null)
  const openSession = useAction()

  // Add student (create account + enroll).
  const [addOpen, setAddOpen] = useState(false)
  const [addName, setAddName] = useState('')
  const [addEmail, setAddEmail] = useState('')
  const [addPassword, setAddPassword] = useState('')
  const add = useAction()

  // Enroll existing student account.
  const [enrollOpen, setEnrollOpen] = useState(false)
  const [enrollEmail, setEnrollEmail] = useState('')
  const enroll = useAction()

  // Edit student details.
  const [editing, setEditing] = useState<RosterEntry | null>(null)
  const [editName, setEditName] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const edit = useAction()

  // Reset student password.
  const [resetTarget, setResetTarget] = useState<RosterEntry | null>(null)
  const [resetPassword, setResetPassword] = useState('')
  const reset = useAction()

  // Unenroll confirmation.
  const [unenrollTarget, setUnenrollTarget] = useState<RosterEntry | null>(null)
  const unenroll = useAction()

  const submitOpenSession = () => {
    if (!classId) {
      return
    }
    void openSession.run(async () => {
      const result = await apiFetch<OpenSessionResponse>(`/api/faculty/classes/${classId}/sessions`, {
        method: 'POST',
      })
      storeSessionOtp(result.session.id, result.otp)
      navigate(`/faculty/sessions/${result.session.id}`)
    })
  }

  const openAdd = () => {
    add.reset()
    setAddName('')
    setAddEmail('')
    setAddPassword('')
    setAddOpen(true)
  }

  const submitAdd = () => {
    if (!classId) {
      return
    }
    void add.run(async () => {
      await apiFetch(`/api/faculty/classes/${classId}/students`, {
        method: 'POST',
        body: { fullName: addName, email: addEmail, password: addPassword },
      })
      setAddOpen(false)
      setFlash({ tone: 'success', text: `${addName} created and enrolled.` })
      detail.reload()
    })
  }

  const openEnroll = () => {
    enroll.reset()
    setEnrollEmail('')
    setEnrollOpen(true)
  }

  const submitEnroll = () => {
    if (!classId) {
      return
    }
    void enroll.run(async () => {
      await apiFetch(`/api/faculty/classes/${classId}/enroll`, {
        method: 'POST',
        body: { email: enrollEmail },
      })
      setEnrollOpen(false)
      setFlash({ tone: 'success', text: 'Student enrolled in this class.' })
      detail.reload()
    })
  }

  const openEdit = (entry: RosterEntry) => {
    edit.reset()
    setEditing(entry)
    setEditName(entry.student.fullName)
    setEditEmail(entry.student.email)
  }

  const submitEdit = () => {
    const target = editing
    if (!classId || !target) {
      return
    }
    void edit.run(async () => {
      await apiFetch(`/api/faculty/classes/${classId}/students/${target.student.id}`, {
        method: 'PATCH',
        body: { fullName: editName, email: editEmail },
      })
      setEditing(null)
      setFlash({ tone: 'success', text: 'Student details updated.' })
      detail.reload()
    })
  }

  const openReset = (entry: RosterEntry) => {
    reset.reset()
    setResetTarget(entry)
    setResetPassword('')
  }

  const submitReset = () => {
    const target = resetTarget
    if (!classId || !target) {
      return
    }
    void reset.run(async () => {
      await apiFetch(
        `/api/faculty/classes/${classId}/students/${target.student.id}/reset-password`,
        { method: 'POST', body: { newPassword: resetPassword } },
      )
      setResetTarget(null)
      setFlash({
        tone: 'success',
        text: `Password reset for ${target.student.fullName}. Share it safely.`,
      })
    })
  }

  const confirmUnenroll = () => {
    const target = unenrollTarget
    if (!classId || !target) {
      return
    }
    void unenroll.run(async () => {
      await apiFetch(
        `/api/faculty/classes/${classId}/students/${target.student.id}/unenroll`,
        { method: 'POST' },
      )
      setUnenrollTarget(null)
      setFlash({
        tone: 'success',
        text: `${target.student.fullName} unenrolled. The history is kept.`,
      })
      detail.reload()
    })
  }

  return (
    <AppShell>
      <div className="mb-2">
        <Link to="/faculty" className="text-sm font-medium text-indigo-600 hover:underline">
          ← My classes
        </Link>
      </div>

      <PageHeader
        title={detail.data ? detail.data.class.name : 'Class roster'}
        description={
          detail.data
            ? `${detail.data.class.department.name} · ${detail.data.class.academicYear} · ${detail.data.students.length} active ${detail.data.students.length === 1 ? 'student' : 'students'}`
            : 'Manage this class’s student roster.'
        }
        actions={
          detail.data ? (
            <>
              <Link
                to={`/faculty/classes/${detail.data.class.id}/report`}
                className="text-sm font-medium text-indigo-600 hover:underline"
              >
                Attendance report
              </Link>
              <Button onClick={openEnroll}>Enroll existing</Button>
              <Button variant="primary" onClick={openAdd}>
                Add student
              </Button>
            </>
          ) : undefined
        }
      />

      {flash && (
        <Alert tone={flash.tone} className="mb-4">
          {flash.text}
        </Alert>
      )}
      {detail.error && <Alert className="mb-4">{detail.error}</Alert>}
      {detail.loading && <p className="text-sm text-slate-500">Loading roster…</p>}

      <section className="mb-8">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Today’s attendance
        </h3>
        {attendance.error && <Alert className="mb-3">{attendance.error}</Alert>}
        {attendance.loading && <p className="text-sm text-slate-500">Loading attendance…</p>}

        {attendance.data && attendance.data.today === null && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-slate-300 bg-white px-5 py-4">
            <div>
              <p className="text-sm font-medium text-slate-700">No session opened today.</p>
              <p className="text-xs text-slate-500">
                Opening the session generates a one-time code students use to mark themselves
                present.
              </p>
            </div>
            <Button variant="primary" loading={openSession.busy} onClick={submitOpenSession}>
              Open today’s session
            </Button>
          </div>
        )}
        {openSession.error && <Alert className="mt-3">{openSession.error}</Alert>}

        {attendance.data && attendance.data.today && (
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  {attendance.data.today.status === 'open' ? (
                    <Badge tone="success">Open</Badge>
                  ) : (
                    <Badge tone="muted">Closed</Badge>
                  )}
                  <span className="text-sm text-slate-600">
                    {formatDate(attendance.data.today.sessionDate)}
                  </span>
                </div>
                <p className="mt-2 text-sm text-slate-600">
                  {attendance.data.today.counts.present} present ·{' '}
                  {attendance.data.today.counts.pending} pending ·{' '}
                  {attendance.data.today.counts.absent} absent
                  {attendance.data.today.status === 'open' && attendance.data.today.otpActive
                    ? ` · OTP valid until ${formatTime(attendance.data.today.otpExpiresAt)}`
                    : ''}
                </p>
              </div>
              <Link
                to={`/faculty/sessions/${attendance.data.today.id}`}
                className="inline-flex items-center justify-center rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
              >
                {attendance.data.today.status === 'open' ? 'Open session view' : 'View session'}
              </Link>
            </div>
          </div>
        )}

        {attendance.data && attendance.data.recent.length > 0 && (
          <>
            <h4 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Recent sessions
            </h4>
            <Table label="Recent attendance sessions">
              <thead>
                <tr>
                  <Th>Date</Th>
                  <Th>Status</Th>
                  <Th>Present</Th>
                  <Th>Pending</Th>
                  <Th>Absent</Th>
                  <Th>
                    <span className="sr-only">Open</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {attendance.data.recent.map((entry) => (
                  <tr key={entry.id}>
                    <Td className="whitespace-nowrap font-medium text-slate-900">
                      {formatDate(entry.sessionDate)}
                    </Td>
                    <Td>
                      {entry.status === 'open' ? (
                        <Badge tone="success">Open</Badge>
                      ) : (
                        <Badge tone="muted">Closed</Badge>
                      )}
                    </Td>
                    <Td className="text-slate-600">{entry.counts.present}</Td>
                    <Td className="text-slate-600">{entry.counts.pending}</Td>
                    <Td className="text-slate-600">{entry.counts.absent}</Td>
                    <Td>
                      <div className="flex justify-end">
                        <Link
                          to={`/faculty/sessions/${entry.id}`}
                          className="text-sm font-medium text-indigo-600 hover:underline"
                        >
                          View
                        </Link>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </>
        )}
      </section>

      {detail.data && (
        <>
          {detail.data.students.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-sm text-slate-500">
              No students enrolled yet. Use “Add student” to create the first account.
            </p>
          ) : (
            <Table label="Active roster">
              <thead>
                <tr>
                  <Th>Student</Th>
                  <Th>Email</Th>
                  <Th>Account</Th>
                  <Th>Enrolled</Th>
                  <Th>
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {detail.data.students.map((entry) => (
                  <tr key={entry.enrollmentId}>
                    <Td className="font-medium text-slate-900">{entry.student.fullName}</Td>
                    <Td className="text-slate-600">{entry.student.email}</Td>
                    <Td>
                      {entry.student.isActive ? (
                        <Badge tone="success">Active</Badge>
                      ) : (
                        <Badge tone="muted">Deactivated</Badge>
                      )}
                    </Td>
                    <Td className="whitespace-nowrap text-slate-600">
                      {formatDate(entry.enrolledAt)}
                    </Td>
                    <Td>
                      <div className="flex justify-end gap-0.5">
                        <Button variant="ghost" onClick={() => openEdit(entry)}>
                          Edit
                        </Button>
                        <Button variant="ghost" onClick={() => openReset(entry)}>
                          Reset password
                        </Button>
                        <Button
                          variant="ghost"
                          className="text-rose-600 hover:bg-rose-50"
                          onClick={() => {
                            unenroll.reset()
                            setUnenrollTarget(entry)
                          }}
                        >
                          Unenroll
                        </Button>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}

          {detail.data.formerStudents.length > 0 && (
            <>
              <h3 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wide text-slate-500">
                Former students
              </h3>
              <Table label="Former students">
                <thead>
                  <tr>
                    <Th>Student</Th>
                    <Th>Email</Th>
                    <Th>Enrolled</Th>
                    <Th>Unenrolled</Th>
                  </tr>
                </thead>
                <tbody>
                  {detail.data.formerStudents.map((entry) => (
                    <tr key={entry.enrollmentId}>
                      <Td className="text-slate-900">{entry.student.fullName}</Td>
                      <Td className="text-slate-600">{entry.student.email}</Td>
                      <Td className="whitespace-nowrap text-slate-600">
                        {formatDate(entry.enrolledAt)}
                      </Td>
                      <Td className="whitespace-nowrap text-slate-600">
                        {formatDate(entry.unenrolledAt)}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </>
          )}
        </>
      )}

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add student">
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            submitAdd()
          }}
        >
          <TextField
            id="student-name"
            label="Full name"
            value={addName}
            onChange={(event) => setAddName(event.target.value)}
            error={add.issues.fullName}
            required
            maxLength={120}
          />
          <TextField
            id="student-email"
            label="Email"
            type="email"
            value={addEmail}
            onChange={(event) => setAddEmail(event.target.value)}
            error={add.issues.email}
            required
          />
          <TextField
            id="student-password"
            label="Initial password"
            type="password"
            value={addPassword}
            onChange={(event) => setAddPassword(event.target.value)}
            error={add.issues.password}
            hint="At least 8 characters with a letter and a number. The student signs in with it from the attendance phase onward."
            required
            autoComplete="new-password"
          />
          {add.error && <Alert>{add.error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button onClick={() => setAddOpen(false)} disabled={add.busy}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={add.busy}>
              Create and enroll
            </Button>
          </div>
        </form>
      </Modal>

      <Modal open={enrollOpen} onClose={() => setEnrollOpen(false)} title="Enroll existing student">
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            submitEnroll()
          }}
        >
          <TextField
            id="enroll-email"
            label="Student email"
            type="email"
            value={enrollEmail}
            onChange={(event) => setEnrollEmail(event.target.value)}
            error={enroll.issues.email}
            hint="The student account must already exist (created by any faculty for one of their classes)."
            required
          />
          {enroll.error && <Alert>{enroll.error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button onClick={() => setEnrollOpen(false)} disabled={enroll.busy}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={enroll.busy}>
              Enroll
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={`Edit ${editing?.student.fullName ?? 'student'}`}
      >
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            submitEdit()
          }}
        >
          <TextField
            id="student-edit-name"
            label="Full name"
            value={editName}
            onChange={(event) => setEditName(event.target.value)}
            error={edit.issues.fullName}
            required
            maxLength={120}
          />
          <TextField
            id="student-edit-email"
            label="Email"
            type="email"
            value={editEmail}
            onChange={(event) => setEditEmail(event.target.value)}
            error={edit.issues.email}
            required
          />
          {edit.error && <Alert>{edit.error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button onClick={() => setEditing(null)} disabled={edit.busy}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={edit.busy}>
              Save changes
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={resetTarget !== null}
        onClose={() => setResetTarget(null)}
        title={`Reset password for ${resetTarget?.student.fullName ?? 'student'}`}
      >
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            submitReset()
          }}
        >
          <TextField
            id="student-new-password"
            label="New password"
            type="password"
            value={resetPassword}
            onChange={(event) => setResetPassword(event.target.value)}
            error={reset.issues.newPassword}
            hint="At least 8 characters with a letter and a number."
            required
            autoComplete="new-password"
          />
          {reset.error && <Alert>{reset.error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button onClick={() => setResetTarget(null)} disabled={reset.busy}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={reset.busy}>
              Reset password
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={unenrollTarget !== null}
        onClose={() => setUnenrollTarget(null)}
        onConfirm={confirmUnenroll}
        title={`Unenroll ${unenrollTarget?.student.fullName ?? 'student'}?`}
        message="The student leaves this class's active roster and stops counting as enrolled. Their account and past attendance records are kept, and they can be enrolled again later."
        confirmLabel="Unenroll"
        danger
        busy={unenroll.busy}
        error={unenroll.error}
      />
    </AppShell>
  )
}
