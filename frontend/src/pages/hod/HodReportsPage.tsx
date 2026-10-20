import { useState } from 'react'
import { Link } from 'react-router'
import AppShell from '../../components/AppShell'
import AttendanceBars from '../../components/AttendanceBars'
import DateRangeFilter from '../../components/DateRangeFilter'
import Alert from '../../components/ui/Alert'
import Button from '../../components/ui/Button'
import EmptyState from '../../components/ui/EmptyState'
import LoadingSkeleton from '../../components/ui/LoadingSkeleton'
import PageHeader from '../../components/ui/PageHeader'
import StatCard from '../../components/ui/StatCard'
import { Table, Td, Th } from '../../components/ui/Table'
import type { DepartmentReport } from '../../lib/api-types'
import { downloadCsv, type CsvCell } from '../../lib/csv'
import { defaultRangeIso, formatPercent } from '../../lib/format'
import { useFetch } from '../../lib/use-fetch'

const initialRange = defaultRangeIso()

/**
 * HOD report: attendance across the department's classes. Only closed
 * sessions count toward percentages; open a class to see its detail.
 */
export default function HodReportsPage() {
  const [from, setFrom] = useState(initialRange.from)
  const [to, setTo] = useState(initialRange.to)
  const report = useFetch<DepartmentReport>(`/api/hod/reports/attendance?from=${from}&to=${to}`)

  const exportCsv = () => {
    if (!report.data) {
      return
    }
    const data = report.data
    const rows: CsvCell[][] = [
      ['Department attendance report'],
      ['Department', data.department.name],
      ['Code', data.department.code],
      ['Range', `${data.from} to ${data.to}`],
      [],
      ['Totals'],
      ['Sessions', 'Settled sessions', 'Present', 'On duty', 'Absent', 'Attendance %'],
      [
        data.totals.sessions,
        data.totals.settledSessions,
        data.totals.present,
        data.totals.onDuty,
        data.totals.absent,
        data.totals.percentage === null ? '' : data.totals.percentage.toFixed(1),
      ],
      [],
      ['Classes'],
      [
        'Class',
        'Academic year',
        'Students',
        'Sessions',
        'Settled sessions',
        'Present',
        'On duty',
        'Absent',
        'Attendance %',
      ],
      ...data.classes.map((entry) => [
        entry.className,
        entry.academicYear,
        entry.studentCount,
        entry.sessions,
        entry.settledSessions,
        entry.present,
        entry.onDuty,
        entry.absent,
        entry.percentage === null ? '' : entry.percentage.toFixed(1),
      ]),
    ]
    downloadCsv(
      `attendance-${data.department.code}-${data.from}-to-${data.to}.csv`,
      rows,
    )
  }

  return (
    <AppShell>
      <PageHeader
        title={report.data ? `${report.data.department.name} reports` : 'Department reports'}
        description="Attendance across your department's classes. Percentages count closed sessions only."
        actions={
          report.data ? (
            <Button variant="secondary" onClick={exportCsv}>
              Download CSV
            </Button>
          ) : undefined
        }
      />

      <DateRangeFilter
        idPrefix="hod-report"
        from={from}
        to={to}
        onFromChange={setFrom}
        onToChange={setTo}
      />

      {report.error && <Alert className="mb-4">{report.error}</Alert>}
      {report.loading && <LoadingSkeleton label="Loading report…" cards={5} rows={4} />}

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

          <div className="mt-6">
            <AttendanceBars
              title="Attendance by class"
              description="Present + on duty ÷ settled marks, across the selected range."
              items={report.data.classes.map((entry) => ({
                key: entry.classId,
                label: entry.className,
                sublabel: `${entry.academicYear} · ${entry.studentCount} ${
                  entry.studentCount === 1 ? 'student' : 'students'
                }`,
                detail: `${entry.present + entry.onDuty} present/on duty · ${entry.absent} absent`,
                percentage: entry.percentage,
              }))}
              emptyMessage="No class attendance in this range yet."
            />
          </div>

          <h3 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Classes
          </h3>

          {report.data.classes.length === 0 ? (
            <EmptyState
              title="No classes in your department yet"
              description="Classes are created by the administrator. Once they exist, reports appear here."
            />
          ) : (
            <Table label="Attendance by class">
              <thead>
                <tr>
                  <Th>Class</Th>
                  <Th className="text-right">Students</Th>
                  <Th className="text-right">Settled</Th>
                  <Th className="text-right">Present</Th>
                  <Th className="text-right">On duty</Th>
                  <Th className="text-right">Absent</Th>
                  <Th className="text-right">Attendance</Th>
                  <Th>
                    <span className="sr-only">Open</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {report.data.classes.map((entry) => (
                  <tr key={entry.classId}>
                    <Td>
                      <span className="font-medium text-slate-900">{entry.className}</span>
                      <p className="text-xs text-slate-500">{entry.academicYear}</p>
                    </Td>
                    <Td className="text-right tabular-nums">{entry.studentCount}</Td>
                    <Td className="text-right tabular-nums">{entry.settledSessions}</Td>
                    <Td className="text-right tabular-nums">{entry.present}</Td>
                    <Td className="text-right tabular-nums">{entry.onDuty}</Td>
                    <Td className="text-right tabular-nums">{entry.absent}</Td>
                    <Td className="text-right font-medium tabular-nums">
                      {formatPercent(entry.percentage)}
                    </Td>
                    <Td>
                      <div className="flex justify-end">
                        <Link
                          to={`/hod/classes/${entry.classId}/report`}
                          className="whitespace-nowrap text-sm font-medium text-indigo-600 hover:underline"
                        >
                          Class report →
                        </Link>
                      </div>
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
