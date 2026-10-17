import { useState } from 'react'
import AppShell from '../../components/AppShell'
import DateRangeFilter from '../../components/DateRangeFilter'
import Alert from '../../components/ui/Alert'
import EmptyState from '../../components/ui/EmptyState'
import PageHeader from '../../components/ui/PageHeader'
import StatCard from '../../components/ui/StatCard'
import { Table, Td, Th } from '../../components/ui/Table'
import type { SystemReport } from '../../lib/api-types'
import { defaultRangeIso, formatPercent } from '../../lib/format'
import { useFetch } from '../../lib/use-fetch'

const initialRange = defaultRangeIso()

/**
 * Admin report: system-wide attendance by department and by class. Only
 * closed sessions count toward percentages; a session that is still open
 * appears as pending in the class report and is excluded here.
 */
export default function AdminReportsPage() {
  const [from, setFrom] = useState(initialRange.from)
  const [to, setTo] = useState(initialRange.to)
  const report = useFetch<SystemReport>(`/api/admin/reports/attendance?from=${from}&to=${to}`)

  return (
    <AppShell>
      <PageHeader
        title="Attendance reports"
        description="System-wide attendance. Percentages count closed sessions only, so a session that is still open never drags them down."
      />

      <DateRangeFilter
        idPrefix="admin-report"
        from={from}
        to={to}
        onFromChange={setFrom}
        onToChange={setTo}
      />

      {report.error && <Alert className="mb-4">{report.error}</Alert>}
      {report.loading && <p className="text-sm text-slate-500">Loading report…</p>}

      {report.data && (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            <StatCard
              label="Settled sessions"
              value={report.data.totals.settledSessions}
              hint={`${report.data.totals.sessions} session${report.data.totals.sessions === 1 ? '' : 's'} in range`}
            />
            <StatCard label="Present marks" value={report.data.totals.present} />
            <StatCard label="On duty" value={report.data.totals.onDuty} hint="Excused attendance" />
            <StatCard label="Absent marks" value={report.data.totals.absent} />
            <StatCard
              label="Attendance"
              value={formatPercent(report.data.totals.percentage)}
              hint="Present + OD ÷ settled marks"
            />
          </div>

          <h3 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wide text-slate-500">
            By department
          </h3>

          {report.data.departments.length === 0 ? (
            <EmptyState
              title="No departments yet"
              description="Create departments and classes under Administration."
            />
          ) : (
            <Table label="Attendance by department">
              <thead>
                <tr>
                  <Th>Department</Th>
                  <Th className="text-right">Classes</Th>
                  <Th className="text-right">Students</Th>
                  <Th className="text-right">Settled</Th>
                  <Th className="text-right">Present</Th>
                  <Th className="text-right">On duty</Th>
                  <Th className="text-right">Absent</Th>
                  <Th className="text-right">Attendance</Th>
                </tr>
              </thead>
              <tbody>
                {report.data.departments.map((entry) => (
                  <tr key={entry.departmentId}>
                    <Td>
                      <span className="font-medium text-slate-900">{entry.departmentName}</span>
                      <p className="text-xs text-slate-500">{entry.departmentCode}</p>
                    </Td>
                    <Td className="text-right tabular-nums">{entry.classCount}</Td>
                    <Td className="text-right tabular-nums">{entry.studentCount}</Td>
                    <Td className="text-right tabular-nums">{entry.settledSessions}</Td>
                    <Td className="text-right tabular-nums">{entry.present}</Td>
                    <Td className="text-right tabular-nums">{entry.onDuty}</Td>
                    <Td className="text-right tabular-nums">{entry.absent}</Td>
                    <Td className="text-right font-medium tabular-nums">
                      {formatPercent(entry.percentage)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}

          <h3 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wide text-slate-500">
            By class
          </h3>

          {report.data.classes.length === 0 ? (
            <EmptyState
              title="No classes yet"
              description="Classes are created per department under Administration."
            />
          ) : (
            <Table label="Attendance by class">
              <thead>
                <tr>
                  <Th>Class</Th>
                  <Th>Department</Th>
                  <Th className="text-right">Students</Th>
                  <Th className="text-right">Settled</Th>
                  <Th className="text-right">Present</Th>
                  <Th className="text-right">On duty</Th>
                  <Th className="text-right">Absent</Th>
                  <Th className="text-right">Attendance</Th>
                </tr>
              </thead>
              <tbody>
                {report.data.classes.map((entry) => (
                  <tr key={entry.classId}>
                    <Td>
                      <span className="font-medium text-slate-900">{entry.className}</span>
                      <p className="text-xs text-slate-500">{entry.academicYear}</p>
                    </Td>
                    <Td>{entry.department.name}</Td>
                    <Td className="text-right tabular-nums">{entry.studentCount}</Td>
                    <Td className="text-right tabular-nums">{entry.settledSessions}</Td>
                    <Td className="text-right tabular-nums">{entry.present}</Td>
                    <Td className="text-right tabular-nums">{entry.onDuty}</Td>
                    <Td className="text-right tabular-nums">{entry.absent}</Td>
                    <Td className="text-right font-medium tabular-nums">
                      {formatPercent(entry.percentage)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </>
      )}
    </AppShell>
  )
}
