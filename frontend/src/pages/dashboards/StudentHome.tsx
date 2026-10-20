import { useState } from 'react'
import AppShell from '../../components/AppShell'
import AttendanceCalendar from '../../components/AttendanceCalendar'
import DateRangeFilter from '../../components/DateRangeFilter'
import Alert from '../../components/ui/Alert'
import Badge from '../../components/ui/Badge'
import Button from '../../components/ui/Button'
import EmptyState from '../../components/ui/EmptyState'
import { TextField } from '../../components/ui/FormField'
import LoadingSkeleton from '../../components/ui/LoadingSkeleton'
import PageHeader from '../../components/ui/PageHeader'
import StatCard from '../../components/ui/StatCard'
import { Table, Td, Th } from '../../components/ui/Table'
import { apiFetch } from '../../lib/api'
import type {
  StudentHistoryEntry,
  StudentHistoryResponse,
  StudentMarkResponse,
  StudentTodayEntry,
  StudentTodayResponse,
} from '../../lib/api-types'
import { defaultRangeIso, formatDate, formatDateTime, formatPercent } from '../../lib/format'
import { useAction } from '../../lib/forms'
import { useFetch } from '../../lib/use-fetch'

type StudentSection = 'today' | 'calendar' | 'history'

const STUDENT_SECTIONS: Array<{ id: StudentSection; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'history', label: 'History' },
]

function SectionIcon({ section }: { section: StudentSection }) {
  const paths: Record<StudentSection, string> = {
    today: 'M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
    calendar:
      'M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5',
    history: 'M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  }

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-5"
    >
      <path d={paths[section]} />
    </svg>
  )
}

function StudentDaySummary({ entries }: { entries: StudentTodayEntry[] }) {
  const total = entries.length
  const marked = entries.filter((entry) => entry.record !== null).length
  const waiting = entries.filter(
    (entry) => !entry.record && entry.session?.status === 'open' && entry.session.otpActive,
  ).length
  const unopened = entries.filter((entry) => entry.session === null).length
  const percent = total === 0 ? 0 : Math.round((marked / total) * 100)
  const complete = total > 0 && marked === total

  return (
    <section className="mb-6 rounded-xl border border-indigo-200 bg-indigo-50/70 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">
            Today at a glance
          </p>
          <p className="mt-1 text-sm text-indigo-950">
            {complete
              ? 'All of today’s classes are marked.'
              : `${marked} of ${total} ${total === 1 ? 'class' : 'classes'} marked`}
          </p>
        </div>
        <Badge tone={complete ? 'success' : waiting > 0 ? 'info' : 'muted'}>
          {complete
            ? 'All set'
            : waiting > 0
              ? `${waiting} waiting for OTP`
              : unopened > 0
                ? `${unopened} not opened yet`
                : 'In progress'}
        </Badge>
      </div>
      <div
        role="progressbar"
        aria-label="Classes marked today"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={marked}
        className="mt-3 h-2 overflow-hidden rounded-full bg-indigo-100"
      >
        <div
          className={`h-full rounded-full transition-all ${complete ? 'bg-emerald-500' : 'bg-indigo-500'}`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </section>
  )
}

/**
 * Student home: today's attendance for every actively enrolled class with
 * OTP self-marking, followed by the student's own attendance history and
 * settled percentages.
 */
export default function StudentHome() {
  const today = useFetch<StudentTodayResponse>('/api/student/attendance/today')
  const [section, setSection] = useState<StudentSection>('today')

  return (
    <AppShell>
      <div className="pb-20 md:pb-0">
        <PageHeader
          title="My attendance"
          description={
            today.data
              ? `Today is ${formatDate(today.data.date)}. Mark yourself present with the code your faculty member shows.`
              : 'Mark yourself present with the OTP your faculty member shows.'
          }
        />

        {today.error && <Alert className="mb-4">{today.error}</Alert>}
        {today.loading && <LoadingSkeleton label="Loading today’s attendance…" cards={2} rows={2} />}

        <div id="today" className="scroll-mt-24">
          {today.data && today.data.classes.length === 0 && (
            <EmptyState
              title="No classes yet"
              description="You are not actively enrolled in any class. Your faculty member enrolls students after creating your account."
            />
          )}

          {today.data && today.data.classes.length > 0 && (
            <>
              <StudentDaySummary entries={today.data.classes} />
              <div className="space-y-6">
                {today.data.classes.map((entry) => (
                  <StudentClassCard key={entry.class.id} entry={entry} onChanged={today.reload} />
                ))}
              </div>
            </>
          )}
        </div>

        <div id="calendar" className="scroll-mt-24">
          <AttendanceCalendar />
        </div>

        <StudentHistory />

        <nav
          aria-label="Student sections"
          className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
        >
          <div className="mx-auto flex max-w-md items-stretch justify-around px-2">
            {STUDENT_SECTIONS.map((item) => {
              const active = section === item.id
              return (
                <a
                  key={item.id}
                  href={`#${item.id}`}
                  onClick={() => setSection(item.id)}
                  aria-current={active ? 'true' : undefined}
                  className={`flex min-w-0 flex-1 flex-col items-center gap-1 rounded-lg px-2 py-2 text-[11px] font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 ${
                    active ? 'text-indigo-700' : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <SectionIcon section={item.id} />
                  {item.label}
                </a>
              )
            })}
          </div>
        </nav>
      </div>
    </AppShell>
  )
}

function StudentClassCard({ entry, onChanged }: { entry: StudentTodayEntry; onChanged: () => void }) {
  const [otp, setOtp] = useState('')
  const mark = useAction()
  const session = entry.session
  const record = entry.record

  const submit = () => {
    if (!session) {
      return
    }
    void mark.run(async () => {
      await apiFetch<StudentMarkResponse>(`/api/student/sessions/${session.id}/mark`, {
        method: 'POST',
        body: { otp },
      })
      setOtp('')
      onChanged()
    })
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-slate-900">{entry.class.name}</h3>
          <p className="text-sm text-slate-500">
            {entry.class.department.name} · {entry.class.academicYear}
          </p>
        </div>
        {record ? (
          record.status === 'present' ? (
            <Badge tone="success">Present</Badge>
          ) : record.status === 'on_duty' ? (
            <Badge tone="sky">On duty</Badge>
          ) : (
            <Badge tone="warning">Absent</Badge>
          )
        ) : session?.status === 'open' ? (
          <Badge tone="info">Open for marking</Badge>
        ) : null}
      </div>

      <div className="mt-4">
        {session === null && (
          <p className="text-sm text-slate-500">
            Your faculty member hasn’t opened today’s session yet. Check back during the morning.
          </p>
        )}

        {session && record && (
          <p className="text-sm text-slate-600">
            {record.status === 'present'
              ? 'You were marked present'
              : record.status === 'on_duty'
                ? 'You were marked on duty (excused)'
                : 'You were marked absent'}
            {record.method === 'otp' ? ' with the OTP' : ' by your faculty member'} at{' '}
            {formatDateTime(record.markedAt)}.
            {record.status === 'absent'
              ? ' If that is wrong, ask your faculty member to correct it.'
              : ''}
          </p>
        )}

        {session && !record && session.status === 'closed' && (
          <p className="text-sm text-slate-500">
            Today’s session is closed and no record was kept for you.
          </p>
        )}

        {session && !record && session.status === 'open' && session.otpActive && (
          <form
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
            onSubmit={(event) => {
              event.preventDefault()
              submit()
            }}
          >
            <div className="w-full sm:w-56">
              <TextField
                id={`otp-${entry.class.id}`}
                label="Attendance OTP"
                value={otp}
                onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="6-digit code"
                maxLength={6}
                className="text-center font-mono text-lg tracking-[0.35em]"
                required
              />
            </div>
            <Button
              type="submit"
              variant="primary"
              className="w-full sm:w-auto"
              loading={mark.busy}
              disabled={otp.length !== 6}
            >
              Mark me present
            </Button>
          </form>
        )}

        {session && !record && session.status === 'open' && !session.otpActive && (
          <Alert tone="info">
            The OTP has expired. Ask your faculty member to show or regenerate it.
          </Alert>
        )}

        {session && !record && session.status === 'open' && mark.error && (
          <Alert className="mt-3">{mark.error}</Alert>
        )}
      </div>
    </section>
  )
}

/**
 * The student's own session history with settled percentages. Only closed
 * sessions count toward the percentage; today's open session shows as
 * pending until faculty close it.
 */
function StudentHistoryBadge({ entry }: { entry: StudentHistoryEntry }) {
  if (entry.status === 'present') {
    return <Badge tone="success">Present</Badge>
  }
  if (entry.status === 'on_duty') {
    return <Badge tone="sky">On duty</Badge>
  }
  if (entry.status === 'absent') {
    return <Badge tone="warning">Absent</Badge>
  }
  if (entry.sessionStatus === 'open') {
    return <Badge tone="info">Pending</Badge>
  }
  return <Badge tone="muted">No record</Badge>
}

function markedLabel(entry: StudentHistoryEntry): string {
  if (!entry.markedAt) {
    return '—'
  }
  return `${formatDateTime(entry.markedAt)}${entry.method === 'otp' ? ' · OTP' : ' · by faculty'}`
}

function StudentHistory() {
  const [range, setRange] = useState(() => defaultRangeIso())
  const history = useFetch<StudentHistoryResponse>(
    `/api/student/attendance/history?from=${range.from}&to=${range.to}`,
  )

  return (
    <section id="history" className="mt-10 scroll-mt-24">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
        Attendance history
      </h3>
      <p className="mt-1 text-sm text-slate-500">
        Percentages count closed sessions only; today’s session stays pending until it is closed.
      </p>

      <div className="mt-4">
        <DateRangeFilter
          idPrefix="student-history"
          from={range.from}
          to={range.to}
          onFromChange={(from) => setRange((current) => ({ ...current, from }))}
          onToChange={(to) => setRange((current) => ({ ...current, to }))}
        />
      </div>

      {history.error && <Alert className="mb-4">{history.error}</Alert>}
      {history.loading && <LoadingSkeleton label="Loading history…" cards={5} rows={3} />}

      {history.data && (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            <StatCard label="Present" value={history.data.totals.present} />
            <StatCard label="On duty" value={history.data.totals.onDuty} hint="Excused" />
            <StatCard label="Absent" value={history.data.totals.absent} />
            <StatCard
              label="Attendance"
              value={formatPercent(history.data.totals.percentage)}
              hint="Present + OD ÷ settled sessions"
            />
            <StatCard
              label="Sessions in range"
              value={history.data.totals.sessions}
              hint={`${history.data.totals.settledSessions} settled`}
            />
          </div>

          {history.data.sessions.length === 0 ? (
            <div className="mt-4">
              <EmptyState
                title="No sessions in this range"
                description="Pick a wider date range or check back after your next morning session."
              />
            </div>
          ) : (
            <>
              <div className="mt-4 space-y-3 md:hidden">
                {history.data.sessions.map((entry) => (
                  <article
                    key={entry.sessionId}
                    className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium text-slate-900">
                          {formatDate(entry.sessionDate)}
                        </p>
                        <p className="truncate text-xs text-slate-500">{entry.className}</p>
                      </div>
                      <StudentHistoryBadge entry={entry} />
                    </div>
                    <p className="mt-2 text-xs text-slate-500">{markedLabel(entry)}</p>
                  </article>
                ))}
              </div>

              <div className="mt-4 hidden md:block">
                <Table label="Attendance history">
                  <thead>
                    <tr>
                      <Th>Date</Th>
                      <Th>Class</Th>
                      <Th>Status</Th>
                      <Th>Marked</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.data.sessions.map((entry) => (
                      <tr key={entry.sessionId}>
                        <Td className="whitespace-nowrap font-medium text-slate-900">
                          {formatDate(entry.sessionDate)}
                        </Td>
                        <Td>{entry.className}</Td>
                        <Td>
                          <StudentHistoryBadge entry={entry} />
                        </Td>
                        <Td className="text-slate-600">{markedLabel(entry)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            </>
          )}
        </>
      )}
    </section>
  )
}
