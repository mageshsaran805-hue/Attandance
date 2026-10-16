import { Link } from 'react-router'
import AppShell from '../../components/AppShell'
import Alert from '../../components/ui/Alert'
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
  },
  {
    to: '/admin/classes',
    title: 'Classes',
    description: 'Set up classes per department and academic year.',
  },
  {
    to: '/admin/users',
    title: 'Accounts',
    description: 'Manage HOD, faculty and administrator accounts.',
  },
  {
    to: '/admin/registrations',
    title: 'Student registrations',
    description: 'Review self-registration requests and approve or reject them.',
  },
  {
    to: '/admin/reports',
    title: 'Reports',
    description: 'Attendance percentages by department and class.',
  },
  {
    to: '/admin/audit',
    title: 'Audit log',
    description: 'Browse sensitive changes with before/after snapshots.',
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
        description="College structure and system-wide accounts. Attendance reports arrive in the reporting phase."
      />

      {overview.error && (
        <Alert className="mb-4">{overview.error}</Alert>
      )}
      {overview.loading && <p className="text-sm text-slate-500">Loading overview…</p>}

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
                className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-indigo-300 hover:shadow"
              >
                <p className="text-sm font-semibold text-slate-900">{link.title}</p>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">{link.description}</p>
                <p className="mt-3 text-xs font-medium text-indigo-600">Open →</p>
              </Link>
            ))}
          </div>
        </>
      )}
    </AppShell>
  )
}
