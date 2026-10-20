import type { ClassReport } from '../lib/api-types'
import { downloadCsv, type CsvCell } from '../lib/csv'
import { formatDate, formatPercent } from '../lib/format'
import SessionTrendChart from './SessionTrendChart'
import Badge from './ui/Badge'
import Button from './ui/Button'
import EmptyState from './ui/EmptyState'
import StatCard from './ui/StatCard'
import { Table, Td, Th } from './ui/Table'

function SessionStatusBadge({ status }: { status: 'open' | 'closed' }) {
  return status === 'closed' ? <Badge tone="muted">Closed</Badge> : <Badge tone="info">Open</Badge>
}

/**
 * Shared class attendance report: totals, per-student percentages and the
 * session list. Only closed sessions count toward percentages; open sessions
 * are listed with their pending count and excluded. On-duty marks are excused
 * and count with present marks in the percentage.
 */
export default function ClassReportView({ report }: { report: ClassReport }) {
  const exportCsv = () => {
    const rows: CsvCell[][] = [
      ['Class attendance report'],
      ['Class', report.class.name],
      ['Department', report.class.department.name],
      ['Academic year', report.class.academicYear],
      ['Range', `${report.from} to ${report.to}`],
      [],
      ['Totals'],
      ['Sessions', 'Settled sessions', 'Present', 'On duty', 'Absent', 'Attendance %'],
      [
        report.totals.sessions,
        report.totals.settledSessions,
        report.totals.present,
        report.totals.onDuty,
        report.totals.absent,
        report.totals.percentage === null ? '' : report.totals.percentage.toFixed(1),
      ],
      [],
      ['Students'],
      ['Student', 'Email', 'Active', 'Present', 'On duty', 'Absent', 'Attendance %'],
      ...report.students.map((student) => [
        student.fullName,
        student.email,
        student.isActive ? 'Yes' : 'No',
        student.present,
        student.onDuty,
        student.absent,
        student.percentage === null ? '' : student.percentage.toFixed(1),
      ]),
      [],
      ['Sessions'],
      ['Date', 'Status', 'Present', 'On duty', 'Absent', 'Pending'],
      ...report.sessions.map((session) => [
        session.sessionDate,
        session.status,
        session.present,
        session.onDuty,
        session.absent,
        session.pending,
      ]),
    ]
    downloadCsv(`attendance-${report.class.name}-${report.from}-to-${report.to}.csv`, rows)
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-500">
          {formatDate(report.from)} – {formatDate(report.to)}
        </p>
        <Button variant="secondary" onClick={exportCsv}>
          Download CSV
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard
          label="Settled sessions"
          value={report.totals.settledSessions}
          hint={`${report.totals.sessions} session${report.totals.sessions === 1 ? '' : 's'} in range`}
        />
        <StatCard label="Present marks" value={report.totals.present} />
        <StatCard label="On duty" value={report.totals.onDuty} hint="Excused attendance" />
        <StatCard label="Absent marks" value={report.totals.absent} />
        <StatCard
          label="Attendance"
          value={formatPercent(report.totals.percentage)}
          hint="Present + OD ÷ settled marks"
        />
      </div>

      <SessionTrendChart sessions={report.sessions} />

      <h3 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Students
      </h3>

      {report.students.length === 0 ? (
        <EmptyState
          title="No students to report on"
          description="Nobody is currently enrolled in this class and no settled records exist in the selected range."
        />
      ) : (
        <>
          <div className="space-y-3 md:hidden">
            {report.students.map((student) => (
              <article
                key={student.studentUserId}
                className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-900">{student.fullName}</p>
                    <p className="truncate text-xs text-slate-500">{student.email}</p>
                    {!student.isActive && (
                      <div className="mt-1">
                        <Badge tone="muted">Inactive account</Badge>
                      </div>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-lg font-semibold tabular-nums text-slate-900">
                      {formatPercent(student.percentage)}
                    </p>
                    <p className="text-[11px] uppercase tracking-wide text-slate-500">
                      Attendance
                    </p>
                  </div>
                </div>
                <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg bg-emerald-50 p-2">
                    <dt className="text-[11px] font-medium uppercase tracking-wide text-emerald-700">
                      Present
                    </dt>
                    <dd className="mt-0.5 text-sm font-semibold tabular-nums text-emerald-900">
                      {student.present}
                    </dd>
                  </div>
                  <div className="rounded-lg bg-sky-50 p-2">
                    <dt className="text-[11px] font-medium uppercase tracking-wide text-sky-700">
                      On duty
                    </dt>
                    <dd className="mt-0.5 text-sm font-semibold tabular-nums text-sky-900">
                      {student.onDuty}
                    </dd>
                  </div>
                  <div className="rounded-lg bg-amber-50 p-2">
                    <dt className="text-[11px] font-medium uppercase tracking-wide text-amber-700">
                      Absent
                    </dt>
                    <dd className="mt-0.5 text-sm font-semibold tabular-nums text-amber-900">
                      {student.absent}
                    </dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>

          <div className="hidden md:block">
            <Table label="Student attendance">
              <thead>
                <tr>
                  <Th>Student</Th>
                  <Th className="text-right">Present</Th>
                  <Th className="text-right">On duty</Th>
                  <Th className="text-right">Absent</Th>
                  <Th className="text-right">Attendance</Th>
                </tr>
              </thead>
              <tbody>
                {report.students.map((student) => (
                  <tr key={student.studentUserId}>
                    <Td>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-slate-900">{student.fullName}</span>
                        {!student.isActive && <Badge tone="muted">Inactive account</Badge>}
                      </div>
                      <p className="text-xs text-slate-500">{student.email}</p>
                    </Td>
                    <Td className="text-right tabular-nums">{student.present}</Td>
                    <Td className="text-right tabular-nums">{student.onDuty}</Td>
                    <Td className="text-right tabular-nums">{student.absent}</Td>
                    <Td className="text-right font-medium tabular-nums">
                      {formatPercent(student.percentage)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        </>
      )}

      <h3 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Sessions
      </h3>

      {report.sessions.length === 0 ? (
        <EmptyState
          title="No sessions in this range"
          description="Sessions opened for this class will appear here with their counts."
        />
      ) : (
        <>
          <div className="space-y-3 md:hidden">
            {report.sessions.map((session) => (
              <article
                key={session.id}
                className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="font-medium text-slate-900">{formatDate(session.sessionDate)}</p>
                  <SessionStatusBadge status={session.status} />
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-center">
                  <div className="rounded-lg bg-emerald-50 p-2">
                    <dt className="text-[11px] font-medium uppercase tracking-wide text-emerald-700">
                      Present
                    </dt>
                    <dd className="mt-0.5 text-sm font-semibold tabular-nums text-emerald-900">
                      {session.present}
                    </dd>
                  </div>
                  <div className="rounded-lg bg-sky-50 p-2">
                    <dt className="text-[11px] font-medium uppercase tracking-wide text-sky-700">
                      On duty
                    </dt>
                    <dd className="mt-0.5 text-sm font-semibold tabular-nums text-sky-900">
                      {session.onDuty}
                    </dd>
                  </div>
                  <div className="rounded-lg bg-amber-50 p-2">
                    <dt className="text-[11px] font-medium uppercase tracking-wide text-amber-700">
                      Absent
                    </dt>
                    <dd className="mt-0.5 text-sm font-semibold tabular-nums text-amber-900">
                      {session.absent}
                    </dd>
                  </div>
                  <div className="rounded-lg bg-indigo-50 p-2">
                    <dt className="text-[11px] font-medium uppercase tracking-wide text-indigo-700">
                      Pending
                    </dt>
                    <dd className="mt-0.5 text-sm font-semibold tabular-nums text-indigo-900">
                      {session.pending}
                    </dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>

          <div className="hidden md:block">
            <Table label="Sessions in range">
              <thead>
                <tr>
                  <Th>Date</Th>
                  <Th>Status</Th>
                  <Th className="text-right">Present</Th>
                  <Th className="text-right">On duty</Th>
                  <Th className="text-right">Absent</Th>
                  <Th className="text-right">Pending</Th>
                </tr>
              </thead>
              <tbody>
                {report.sessions.map((session) => (
                  <tr key={session.id}>
                    <Td className="whitespace-nowrap font-medium text-slate-900">
                      {formatDate(session.sessionDate)}
                    </Td>
                    <Td>
                      <SessionStatusBadge status={session.status} />
                    </Td>
                    <Td className="text-right tabular-nums">{session.present}</Td>
                    <Td className="text-right tabular-nums">{session.onDuty}</Td>
                    <Td className="text-right tabular-nums">{session.absent}</Td>
                    <Td className="text-right tabular-nums">{session.pending}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        </>
      )}
    </>
  )
}
