import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import AppShell from '../../components/AppShell'
import Alert from '../../components/ui/Alert'
import Badge from '../../components/ui/Badge'
import Button from '../../components/ui/Button'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import PageHeader from '../../components/ui/PageHeader'
import StatCard from '../../components/ui/StatCard'
import { Table, Td, Th } from '../../components/ui/Table'
import { apiFetch } from '../../lib/api'
import type {
  CloseSessionResponse,
  FacultySessionResponse,
  ManualMarkResponse,
  MarkAllResponse,
  RegenerateOtpResponse,
  SessionStudentAttendance,
} from '../../lib/api-types'
import { clearSessionOtp, readSessionOtp, storeSessionOtp } from '../../lib/attendance'
import { formatDate, formatDateTime, formatTime } from '../../lib/format'
import { useAction } from '../../lib/forms'
import { useFetch } from '../../lib/use-fetch'

type Flash = { tone: 'success' | 'error'; text: string }

function StatusBadge({ status }: { status: 'present' | 'absent' | null }) {
  if (status === 'present') {
    return <Badge tone="success">Present</Badge>
  }
  if (status === 'absent') {
    return <Badge tone="warning">Absent</Badge>
  }
  return <Badge tone="muted">Pending</Badge>
}

/**
 * One morning session from the faculty side: shows the class the OTP (while
 * it is known in this browser), live presence counts, per-student manual
 * marks/corrections and session closing. While the session is open the view
 * refreshes itself so the roster stays current during the attendance window.
 */
export default function FacultySessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const detail = useFetch<FacultySessionResponse>(
    sessionId ? `/api/faculty/sessions/${sessionId}` : null,
  )
  const session = detail.data?.session ?? null
  const reload = detail.reload

  const [flash, setFlash] = useState<Flash | null>(null)
  const [otp, setOtp] = useState<string | null>(() => (sessionId ? readSessionOtp(sessionId) : null))
  const [regenerateOpen, setRegenerateOpen] = useState(false)
  const [closeOpen, setCloseOpen] = useState(false)
  const [bulkStatus, setBulkStatus] = useState<'present' | 'absent' | null>(null)
  const regenerate = useAction()
  const close = useAction()
  const mark = useAction()
  const bulk = useAction()

  useEffect(() => {
    if (session?.status !== 'open') {
      return
    }
    const timer = setInterval(reload, 20_000)
    return () => clearInterval(timer)
  }, [session?.status, reload])

  const regenerateOtp = () => {
    if (!sessionId) {
      return
    }
    void regenerate.run(async () => {
      const result = await apiFetch<RegenerateOtpResponse>(`/api/faculty/sessions/${sessionId}/otp`, {
        method: 'POST',
      })
      storeSessionOtp(sessionId, result.otp)
      setOtp(result.otp)
      setRegenerateOpen(false)
      setFlash({ tone: 'success', text: 'New OTP generated. The previous code no longer works.' })
      reload()
    })
  }

  const closeSession = () => {
    if (!sessionId) {
      return
    }
    void close.run(async () => {
      const result = await apiFetch<CloseSessionResponse>(
        `/api/faculty/sessions/${sessionId}/close`,
        { method: 'POST' },
      )
      clearSessionOtp(sessionId)
      setOtp(null)
      setCloseOpen(false)
      setFlash({
        tone: 'success',
        text: `Session closed. ${result.absentAdded} pending ${
          result.absentAdded === 1 ? 'student was' : 'students were'
        } marked absent.`,
      })
      reload()
    })
  }

  const markStudent = (student: SessionStudentAttendance, status: 'present' | 'absent') => {
    if (!sessionId) {
      return
    }
    void mark.run(async () => {
      await apiFetch<ManualMarkResponse>(`/api/faculty/sessions/${sessionId}/mark`, {
        method: 'POST',
        body: { studentUserId: student.studentUserId, status },
      })
      reload()
    })
  }

  const markAll = () => {
    if (!sessionId || bulkStatus === null) {
      return
    }
    const status = bulkStatus
    void bulk.run(async () => {
      const result = await apiFetch<MarkAllResponse>(`/api/faculty/sessions/${sessionId}/mark-all`, {
        method: 'POST',
        body: { status },
      })
      setBulkStatus(null)
      setFlash({
        tone: 'success',
        text: `All ${result.marked} enrolled ${
          result.marked === 1 ? 'student' : 'students'
        } marked ${result.status}.`,
      })
      reload()
    })
  }

  return (
    <AppShell>
      <div className="mb-2">
        {session ? (
          <Link
            to={`/faculty/classes/${session.classId}`}
            className="text-sm font-medium text-indigo-600 hover:underline"
          >
            ← Back to class
          </Link>
        ) : null}
      </div>

      <PageHeader
        title={session ? `Attendance — ${session.className}` : 'Attendance session'}
        description={
          session
            ? `${formatDate(session.sessionDate)} · opened by ${session.startedByName}`
            : 'Manual marks, corrections and closing for one session.'
        }
        actions={
          session ? (
            <>
              <Button
                onClick={() => {
                  regenerate.reset()
                  setRegenerateOpen(true)
                }}
                disabled={session.status !== 'open'}
              >
                Regenerate OTP
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  close.reset()
                  setCloseOpen(true)
                }}
                disabled={session.status !== 'open'}
              >
                Close session
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
      {detail.loading && <p className="text-sm text-slate-500">Loading session…</p>}

      {session && (
        <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Enrolled" value={session.counts.enrolled} />
          <StatCard label="Present" value={session.counts.present} />
          <StatCard label="Absent" value={session.counts.absent} />
          <StatCard
            label="Pending"
            value={session.counts.pending}
            hint={session.status === 'open' ? 'Not marked yet' : undefined}
          />
        </div>
      )}

      {session && session.status === 'open' && (
        <div className="mb-6 rounded-xl border border-indigo-200 bg-indigo-50/60 p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">
            Today’s OTP
          </p>
          {otp ? (
            <>
              <p className="mt-2 font-mono text-4xl font-semibold tracking-[0.3em] text-slate-900">
                {otp}
              </p>
              <p className="mt-2 text-sm text-indigo-900">
                Valid until {formatTime(session.otpExpiresAt)} · students sign in and enter this
                code themselves.
              </p>
            </>
          ) : (
            <p className="mt-2 max-w-2xl text-sm text-indigo-900">
              For security the code is only shown in the browser where it was generated (it is
              never stored on the server). Regenerate to display a fresh code for the class.
            </p>
          )}
        </div>
      )}

      {session && session.status === 'closed' && (
        <Alert tone="info" className="mb-6">
          Closed by {session.closedByName ?? 'faculty'} on {formatDateTime(session.closedAt)}.
          Marks below can still be corrected.
        </Alert>
      )}

      {detail.data && (
        <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              Students
            </h3>
            {detail.data.students.length > 0 && (
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  onClick={() => {
                    bulk.reset()
                    setBulkStatus('present')
                  }}
                  disabled={bulk.busy || mark.busy}
                >
                  Mark all present
                </Button>
                <Button
                  variant="ghost"
                  className="text-amber-700 hover:bg-amber-50"
                  onClick={() => {
                    bulk.reset()
                    setBulkStatus('absent')
                  }}
                  disabled={bulk.busy || mark.busy}
                >
                  Mark all absent
                </Button>
              </div>
            )}
          </div>
          {mark.error && <Alert className="mb-3">{mark.error}</Alert>}
          {detail.data.students.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-sm text-slate-500">
              No students are enrolled in this class.
            </p>
          ) : (
            <Table label="Session attendance">
              <thead>
                <tr>
                  <Th>Student</Th>
                  <Th>Status</Th>
                  <Th>Marked by</Th>
                  <Th>Marked at</Th>
                  <Th>
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {detail.data.students.map((student) => (
                  <tr key={student.studentUserId}>
                    <Td>
                      <div className="font-medium text-slate-900">{student.fullName}</div>
                      <div className="text-xs text-slate-500">
                        {student.email}
                        {student.isActive ? '' : ' · deactivated'}
                      </div>
                    </Td>
                    <Td>
                      <StatusBadge status={student.status} />
                    </Td>
                    <Td className="text-slate-600">
                      {student.status === null
                        ? '—'
                        : student.method === 'otp'
                          ? 'Self (OTP)'
                          : 'Faculty'}
                    </Td>
                    <Td className="whitespace-nowrap text-slate-600">
                      {student.status === null ? '—' : formatDateTime(student.markedAt)}
                    </Td>
                    <Td>
                      <div className="flex justify-end gap-0.5">
                        {student.status !== 'present' && (
                          <Button
                            variant="ghost"
                            onClick={() => markStudent(student, 'present')}
                            disabled={mark.busy}
                          >
                            Mark present
                          </Button>
                        )}
                        {student.status !== 'absent' && (
                          <Button
                            variant="ghost"
                            className="text-amber-700 hover:bg-amber-50"
                            onClick={() => markStudent(student, 'absent')}
                            disabled={mark.busy}
                          >
                            Mark absent
                          </Button>
                        )}
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </>
      )}

      <ConfirmDialog
        open={regenerateOpen}
        onClose={() => setRegenerateOpen(false)}
        onConfirm={regenerateOtp}
        title="Regenerate the OTP?"
        message="A new code replaces the current one immediately. Students still holding the old code can no longer mark themselves."
        confirmLabel="Regenerate"
        busy={regenerate.busy}
        error={regenerate.error}
      />

      <ConfirmDialog
        open={closeOpen}
        onClose={() => setCloseOpen(false)}
        onConfirm={closeSession}
        title="Close this session?"
        message={`Students still pending (${session?.counts.pending ?? 0}) are marked absent. Marks stay correctable afterwards.`}
        confirmLabel="Close session"
        danger
        busy={close.busy}
        error={close.error}
      />

      <ConfirmDialog
        open={bulkStatus !== null}
        onClose={() => setBulkStatus(null)}
        onConfirm={markAll}
        title={
          bulkStatus === 'absent' ? 'Mark every student absent?' : 'Mark every student present?'
        }
        message={`All ${session?.counts.enrolled ?? 0} enrolled students are set to ${
          bulkStatus === 'absent' ? 'absent' : 'present'
        }. Existing marks — including OTP self-marks — are overwritten; you can still correct individual students afterwards.`}
        confirmLabel={bulkStatus === 'absent' ? 'Mark all absent' : 'Mark all present'}
        danger={bulkStatus === 'absent'}
        busy={bulk.busy}
        error={bulk.error}
      />
    </AppShell>
  )
}
