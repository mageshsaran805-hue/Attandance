import { Link } from 'react-router'
import AppShell from '../../components/AppShell'
import Alert from '../../components/ui/Alert'
import EmptyState from '../../components/ui/EmptyState'
import PageHeader from '../../components/ui/PageHeader'
import type { ClassListEntry } from '../../lib/api-types'
import { useFetch } from '../../lib/use-fetch'

interface ClassesResponse {
  classes: ClassListEntry[]
}

/** Faculty landing page: the classes this account is assigned to. */
export default function FacultyHome() {
  const classes = useFetch<ClassesResponse>('/api/faculty/classes')

  return (
    <AppShell>
      <PageHeader
        title="My classes"
        description="Classes you are currently assigned to. Open a class to manage its student roster. Assignments are made by your department's HOD."
      />

      {classes.error && <Alert className="mb-4">{classes.error}</Alert>}
      {classes.loading && <p className="text-sm text-slate-500">Loading your classes…</p>}

      {classes.data &&
        (classes.data.classes.length === 0 ? (
          <EmptyState
            title="No classes assigned yet"
            description="Your department's HOD assigns faculty to classes. Once you are assigned, the class appears here."
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {classes.data.classes.map((entry) => (
              <Link
                key={entry.id}
                to={`/faculty/classes/${entry.id}`}
                className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-indigo-300 hover:shadow"
              >
                <p className="text-sm font-semibold text-slate-900">{entry.name}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {entry.department.name} · {entry.academicYear}
                </p>
                <p className="mt-3 text-xs text-slate-500">
                  {entry.studentCount} {entry.studentCount === 1 ? 'student' : 'students'}
                </p>
                <p className="mt-3 text-xs font-medium text-indigo-600">Open roster →</p>
              </Link>
            ))}
          </div>
        ))}
    </AppShell>
  )
}
