import { Link } from 'react-router'
import AppShell from '../../components/AppShell'
import Alert from '../../components/ui/Alert'
import Badge from '../../components/ui/Badge'
import EmptyState from '../../components/ui/EmptyState'
import LoadingSkeleton from '../../components/ui/LoadingSkeleton'
import PageHeader from '../../components/ui/PageHeader'
import StatCard from '../../components/ui/StatCard'
import { Table, Td, Th } from '../../components/ui/Table'
import type { HodOverview } from '../../lib/api-types'
import { useFetch } from '../../lib/use-fetch'

/** HOD landing page: department summary, classes and current faculty. */
export default function HodHome() {
  const overview = useFetch<HodOverview>('/api/hod/overview')

  return (
    <AppShell>
      <PageHeader
        title={overview.data ? overview.data.department.name : 'Department overview'}
        description={
          overview.data
            ? `Department code ${overview.data.department.code}. Assign and reassign faculty to your department's classes, and track attendance under Reports.`
            : 'Department classes, rosters and faculty assignments.'
        }
      />

      {overview.error && <Alert className="mb-4">{overview.error}</Alert>}
      {overview.loading && <LoadingSkeleton label="Loading department…" cards={3} rows={3} />}

      {overview.data && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard label="Classes" value={overview.data.counts.classes} />
            <StatCard label="Students" value={overview.data.counts.students} hint="Currently enrolled" />
            <StatCard
              label="Faculty"
              value={overview.data.counts.faculty}
              hint="Actively assigned to classes"
            />
          </div>

          <h3 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Classes
          </h3>

          {overview.data.classes.length === 0 ? (
            <EmptyState
              title="No classes in your department yet"
              description="Classes are created by the administrator. Once they exist, assign faculty here."
            />
          ) : (
            <Table label="Department classes">
              <thead>
                <tr>
                  <Th>Class</Th>
                  <Th>Academic year</Th>
                  <Th className="text-right">Students</Th>
                  <Th>Current faculty</Th>
                  <Th>
                    <span className="sr-only">Manage</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {overview.data.classes.map((entry) => (
                  <tr key={entry.id}>
                    <Td className="font-medium text-slate-900">{entry.name}</Td>
                    <Td>{entry.academicYear}</Td>
                    <Td className="text-right tabular-nums">{entry.studentCount}</Td>
                    <Td>
                      {entry.faculty.length === 0 ? (
                        <span className="text-slate-500">None assigned</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {entry.faculty.map((member) => (
                            <Badge key={member.id} tone="info">
                              {member.fullName}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </Td>
                    <Td>
                      <div className="flex justify-end">
                        <Link
                          to={`/hod/classes/${entry.id}`}
                          className="whitespace-nowrap text-sm font-medium text-indigo-600 hover:underline"
                        >
                          Manage faculty →
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
