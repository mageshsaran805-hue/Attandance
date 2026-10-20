import { Link } from 'react-router'
import AppShell from '../../components/AppShell'
import Alert from '../../components/ui/Alert'
import LoadingSkeleton from '../../components/ui/LoadingSkeleton'
import PageHeader from '../../components/ui/PageHeader'
import StatCard from '../../components/ui/StatCard'
import type { AdminOverview } from '../../lib/api-types'
import { useAuth } from '../../lib/auth-context'
import { useFetch } from '../../lib/use-fetch'

const QUICK_LINKS = [
  {
    to: '/admin/departments',
    title: 'Departments',
    description: 'Create departments and assign each one its Head of Department.',
    icon: 'M4 4h6v6H4V4Zm10 0h6v6h-6V4ZM4 14h6v6H4v-6Zm10 0h6v6h-6v-6Z',
  },
  {
    to: '/admin/classes',
    title: 'Classes',
    description: 'Set up classes per department and academic year.',
    icon: 'M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5v-15Zm0 15A2.5 2.5 0 0 1 6.5 18H20',
  },
  {
    to: '/admin/users',
    title: 'Accounts',
    description: 'Manage HOD, faculty and administrator accounts.',
    icon: 'M16 19a4 4 0 0 0-8 0M12 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7 8a3.5 3.5 0 0 0-3-3.45M17 11a2.5 2.5 0 1 0 0-5',
  },
  {
    to: '/admin/registrations',
    title: 'Student registrations',
    description: 'Review self-registration requests and approve or reject them.',
    icon: 'M9 4h6M9 4a2 2 0 0 0-2 2v1h10V6a2 2 0 0 0-2-2M7 7H5v13h14V7h-2M9 12h6M9 16h4',
  },
  {
    to: '/admin/reports',
    title: 'Reports',
    description: 'Attendance percentages by department and class.',
    icon: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  },
  {
    to: '/admin/audit',
    title: 'Audit log',
    description: 'Browse sensitive changes with before/after snapshots.',
    icon: 'M12 3 5 6v5c0 4.5 2.9 8.1 7 10 4.1-1.9 7-5.5 7-10V6l-7-3ZM9 12l2 2 4-4',
  },
]

/** Admin landing page: system-wide counts and quick links. */
export default function AdminHome() {
  const { user } = useAuth()
  const overview = useFetch<AdminOverview>('/api/admin/overview')

  return (
    <AppShell>
      <PageHeader
        title={`Welcome, ${user?.fullName ?? 'Administrator'}`}
        description="Manage the college structure, accounts and registration queue, then review attendance reports and audit activity."
      />

      {overview.error && (
        <Alert className="mb-4">{overview.error}</Alert>
      )}
      {overview.loading && <LoadingSkeleton label="Loading overview…" cards={4} rows={3} />}

      {overview.data && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Departments" value={overview.data.counts.departments} />
            <StatCard label="Classes" value={overview.data.counts.classes} />
            <StatCard
              label="Students"
              value={overview.data.counts.accounts.students}
              hint="Active student accounts"
            />
            <StatCard
              label="Registrations"
              value={overview.data.counts.pendingRegistrations}
              hint="Pending review"
            />
          </div>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard
              label="Administrators"
              value={overview.data.counts.accounts.admins}
              hint="Active accounts"
            />
            <StatCard
              label="Heads of Department"
              value={overview.data.counts.accounts.hods}
              hint="Active accounts"
            />
            <StatCard
              label="Faculty"
              value={overview.data.counts.accounts.faculty}
              hint="Active accounts"
            />
          </div>

          <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
            {QUICK_LINKS.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className="group rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 motion-reduce:hover:translate-y-0"
              >
                <span
                  aria-hidden="true"
                  className="grid size-9 place-items-center rounded-lg bg-indigo-50 text-indigo-600 ring-1 ring-indigo-100 transition group-hover:bg-indigo-600 group-hover:text-white"
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
                    <path d={link.icon} />
                  </svg>
                </span>
                <p className="mt-3 text-sm font-semibold text-slate-900">{link.title}</p>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">{link.description}</p>
                <p className="mt-3 text-xs font-medium text-indigo-600 transition group-hover:translate-x-0.5 motion-reduce:group-hover:translate-x-0">
                  Open →
                </p>
              </Link>
            ))}
          </div>
        </>
      )}
    </AppShell>
  )
}
