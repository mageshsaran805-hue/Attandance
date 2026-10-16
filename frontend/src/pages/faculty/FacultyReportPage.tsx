import { useState } from 'react'
import { Link, useParams } from 'react-router'
import AppShell from '../../components/AppShell'
import ClassReportView from '../../components/ClassReportView'
import DateRangeFilter from '../../components/DateRangeFilter'
import Alert from '../../components/ui/Alert'
import PageHeader from '../../components/ui/PageHeader'
import type { ClassReport } from '../../lib/api-types'
import { defaultRangeIso } from '../../lib/format'
import { useFetch } from '../../lib/use-fetch'

const initialRange = defaultRangeIso()

/** Faculty view of one assigned class: roster percentages and sessions. */
export default function FacultyReportPage() {
  const { classId } = useParams<{ classId: string }>()
  const [from, setFrom] = useState(initialRange.from)
  const [to, setTo] = useState(initialRange.to)
  const report = useFetch<ClassReport>(
    classId ? `/api/faculty/classes/${classId}/report?from=${from}&to=${to}` : null,
  )

  return (
    <AppShell>
      <Link
        to={classId ? `/faculty/classes/${classId}` : '/faculty'}
        className="mb-2 inline-block text-sm font-medium text-indigo-600 hover:underline"
      >
        ← Back to class
      </Link>

      <PageHeader
        title={report.data ? report.data.class.name : 'Class report'}
        description={
          report.data
            ? `${report.data.class.department.name} · ${report.data.class.academicYear}. Percentages count closed sessions only.`
            : 'Attendance report for this class.'
        }
      />

      <DateRangeFilter
        idPrefix="faculty-report"
        from={from}
        to={to}
        onFromChange={setFrom}
        onToChange={setTo}
      />

      {report.error && <Alert className="mb-4">{report.error}</Alert>}
      {report.loading && <p className="text-sm text-slate-500">Loading class report…</p>}
      {report.data && <ClassReportView report={report.data} />}
    </AppShell>
  )
}
