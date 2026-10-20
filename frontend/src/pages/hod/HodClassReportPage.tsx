import { useState } from 'react'
import { Link, useParams } from 'react-router'
import AppShell from '../../components/AppShell'
import ClassReportView from '../../components/ClassReportView'
import DateRangeFilter from '../../components/DateRangeFilter'
import Alert from '../../components/ui/Alert'
import LoadingSkeleton from '../../components/ui/LoadingSkeleton'
import PageHeader from '../../components/ui/PageHeader'
import type { ClassReport } from '../../lib/api-types'
import { defaultRangeIso } from '../../lib/format'
import { useFetch } from '../../lib/use-fetch'

const initialRange = defaultRangeIso()

/** HOD view of one class in the department: roster percentages and sessions. */
export default function HodClassReportPage() {
  const { classId } = useParams<{ classId: string }>()
  const [from, setFrom] = useState(initialRange.from)
  const [to, setTo] = useState(initialRange.to)
  const report = useFetch<ClassReport>(
    classId ? `/api/hod/classes/${classId}/report?from=${from}&to=${to}` : null,
  )

  return (
    <AppShell>
      <Link
        to="/hod/reports"
        className="mb-2 inline-block text-sm font-medium text-indigo-600 hover:underline"
      >
        ← Back to reports
      </Link>

      <PageHeader
        title={report.data ? report.data.class.name : 'Class report'}
        description={
          report.data
            ? `${report.data.class.department.name} · ${report.data.class.academicYear}`
            : 'Class attendance report.'
        }
      />

      <DateRangeFilter
        idPrefix="hod-class-report"
        from={from}
        to={to}
        onFromChange={setFrom}
        onToChange={setTo}
      />

      {report.error && <Alert className="mb-4">{report.error}</Alert>}
      {report.loading && <LoadingSkeleton label="Loading class report…" cards={5} rows={5} />}
      {report.data && <ClassReportView report={report.data} />}
    </AppShell>
  )
}
