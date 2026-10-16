import { useState } from 'react'
import AppShell from '../../components/AppShell'
import DateRangeFilter from '../../components/DateRangeFilter'
import Alert from '../../components/ui/Alert'
import Badge from '../../components/ui/Badge'
import Button from '../../components/ui/Button'
import EmptyState from '../../components/ui/EmptyState'
import { TextField } from '../../components/ui/FormField'
import PageHeader from '../../components/ui/PageHeader'
import StatCard from '../../components/ui/StatCard'
import { Table, Td, Th } from '../../components/ui/Table'
import { apiFetch } from '../../lib/api'
import type {
  StudentHistoryResponse,
  StudentMarkResponse,
  StudentTodayEntry,
  StudentTodayResponse,
} from '../../lib/api-types'
import { defaultRangeIso, formatDate, formatDateTime, formatPercent } from '../../lib/format'
import { useAction } from '../../lib/forms'
import { useFetch } from '../../lib/use-fetch'

/**
 * Student home: today's attendance for every actively enrolled class with
 * OTP self-marking, followed by the student's own attendance history and
 * settled percentages.
 */
export default function StudentHome() {
  const today = useFetch<StudentTodayResponse>('/api/student/attendance/today')

  return (
    <AppShell>
      <PageHeader
        title="My attendance"
        description={
          today.data
            ? `Today is ${formatDate(today.data.date)}. Mark yourself present with the code your faculty member shows.`
            : 'Mark yourself present with the OTP your faculty member shows.'
        }
      />

      {today.error && <Alert className="mb-4">{today.error}</Alert>}
      {today.loading && <p className="text-sm text-slate-500">Loading today’s attendance…</p>}

      {today.data && today.data.classes.length === 0 && (
        <EmptyState
          title="No classes yet"
          description="You are not actively enrolled in any class. Your faculty member enrolls students after creating your account."
        />
      )}

      {today.data && today.data.classes.length > 0 && (
        <div className="space-y-6">
          {today.data.classes.map((entry) => (
            <StudentClassCard key={entry.class.id} entry={entry} onChanged={today.reload} />
          ))}
        </div>
      )}

      <StudentHistory />
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
            {record.status === 'present' ? 'You were marked present' : 'You were marked absent'}
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
            className="flex flex-wrap items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault()
              submit()
            }}
          >
            <div className="w-48">
              <TextField
                id={`otp-${entry.class.id}`}
                label="Attendance OTP"
                value={otp}
                onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="6-digit code"
                required
              />
            </div>
            <Button type="submit" variant="primary" loading={mark.busy} disabled={otp.length !== 6}>
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
function StudentHistory() {
  const [range, setRange] = useState(() => defaultRangeIso())
  const history = useFetch<StudentHistoryResponse>(
    `/api/student/attendance/history?from=${range.from}&to=${range.to}`,
  )

  return (
    <section className="mt-10">
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
      {history.loading && <p className="text-sm text-slate-500">Loading history…</p>}

      {history.data && (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Present" value={history.data.totals.present} />
            <StatCard label="Absent" value={history.data.totals.absent} />
            <StatCard
              label="Attendance"
              value={formatPercent(history.data.totals.percentage)}
              hint="Present ÷ settled sessions"
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
            <div className="mt-4">
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
                        {entry.status === 'present' ? (
                          <Badge tone="success">Present</Badge>
                        ) : entry.status === 'absent' ? (
                          <Badge tone="warning">Absent</Badge>
                        ) : entry.sessionStatus === 'open' ? (
                          <Badge tone="info">Pending</Badge>
                        ) : (
                          <Badge tone="muted">No record</Badge>
                        )}
                      </Td>
                      <Td className="text-slate-600">
                        {entry.markedAt
                          ? `${formatDateTime(entry.markedAt)}${entry.method === 'otp' ? ' · OTP' : ' · by faculty'}`
                          : '—'}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
        </>
      )}
    </section>
  )
}
