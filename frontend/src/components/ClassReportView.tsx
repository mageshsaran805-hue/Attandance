import type { ClassReport } from '../lib/api-types'
import { formatDate, formatPercent } from '../lib/format'
import Badge from './ui/Badge'
import EmptyState from './ui/EmptyState'
import StatCard from './ui/StatCard'
import { Table, Td, Th } from './ui/Table'

/**
 * Shared class attendance report: totals, per-student percentages and the
 * session list. Only closed sessions count toward percentages; open sessions
 * are listed with their pending count and excluded. On-duty marks are excused
 * and count with present marks in the percentage.
 */
export default function ClassReportView({ report }: { report: ClassReport }) {
  return (
    <>
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

      <h3 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Students
      </h3>

      {report.students.length === 0 ? (
        <EmptyState
          title="No students to report on"
          description="Nobody is currently enrolled in this class and no settled records exist in the selected range."
        />
      ) : (
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
                  {session.status === 'closed' ? (
                    <Badge tone="muted">Closed</Badge>
                  ) : (
                    <Badge tone="info">Open</Badge>
                  )}
                </Td>
                <Td className="text-right tabular-nums">{session.present}</Td>
                <Td className="text-right tabular-nums">{session.onDuty}</Td>
                <Td className="text-right tabular-nums">{session.absent}</Td>
                <Td className="text-right tabular-nums">{session.pending}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  )
}
