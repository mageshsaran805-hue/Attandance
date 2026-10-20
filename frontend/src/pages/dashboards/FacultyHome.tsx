import { Link } from 'react-router'
import AppShell from '../../components/AppShell'
import Alert from '../../components/ui/Alert'
import EmptyState from '../../components/ui/EmptyState'
import LoadingSkeleton from '../../components/ui/LoadingSkeleton'
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
      {classes.loading && <LoadingSkeleton label="Loading your classes…" cards={2} rows={2} />}

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
                className="group rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 motion-reduce:hover:translate-y-0"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900">{entry.name}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {entry.department.name} · {entry.academicYear}
                    </p>
                  </div>
                  <span
                    aria-hidden="true"
                    className="grid size-9 shrink-0 place-items-center rounded-lg bg-indigo-50 text-indigo-600 ring-1 ring-indigo-100 transition group-hover:bg-indigo-600 group-hover:text-white"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="size-5"
                    >
                      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5v-15Zm0 15A2.5 2.5 0 0 1 6.5 18H20" />
                    </svg>
                  </span>
                </div>
                <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3">
                  <p className="text-xs text-slate-500">
                    {entry.studentCount} {entry.studentCount === 1 ? 'student' : 'students'}
                  </p>
                  <p className="text-xs font-medium text-indigo-600 transition group-hover:translate-x-0.5 motion-reduce:group-hover:translate-x-0">
                    Open roster →
                  </p>
                </div>
              </Link>
            ))}
          </div>
        ))}
    </AppShell>
  )
}
