import { useState } from 'react'
import { Link, useParams } from 'react-router'
import AppShell from '../../components/AppShell'
import Alert from '../../components/ui/Alert'
import Button from '../../components/ui/Button'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import { SelectField } from '../../components/ui/FormField'
import Modal from '../../components/ui/Modal'
import PageHeader from '../../components/ui/PageHeader'
import { Table, Td, Th } from '../../components/ui/Table'
import { apiFetch } from '../../lib/api'
import type { AdminUser, AssignmentDetails, HodClassResponse } from '../../lib/api-types'
import { formatDateTime } from '../../lib/format'
import { useAction } from '../../lib/forms'
import { useFetch } from '../../lib/use-fetch'

interface FacultyResponse {
  faculty: AdminUser[]
}

type Flash = { tone: 'success' | 'error'; text: string }

/**
 * One department class: current faculty assignments with full history, plus
 * assigning new faculty and ending active assignments. Only classes of the
 * HOD's own department are reachable (the backend answers 404 otherwise).
 */
export default function HodClassPage() {
  const { classId } = useParams<{ classId: string }>()
  const detail = useFetch<HodClassResponse>(classId ? `/api/hod/classes/${classId}` : null)
  const [flash, setFlash] = useState<Flash | null>(null)

  // Assign faculty modal.
  const [assignOpen, setAssignOpen] = useState(false)
  const [facultyChoice, setFacultyChoice] = useState('')
  const assign = useAction()
  const facultyList = useFetch<FacultyResponse>(assignOpen ? '/api/hod/faculty' : null)

  // End assignment confirmation.
  const [removing, setRemoving] = useState<AssignmentDetails | null>(null)
  const remove = useAction()

  const activeFacultyIds = new Set(
    detail.data?.assignments.active.map((assignment) => assignment.facultyUserId) ?? [],
  )
  const eligibleFaculty = (facultyList.data?.faculty ?? []).filter(
    (member) => !activeFacultyIds.has(member.id),
  )

  const openAssign = () => {
    assign.reset()
    setFacultyChoice('')
    setAssignOpen(true)
  }

  const submitAssign = () => {
    if (!classId) {
      return
    }
    void assign.run(async () => {
      await apiFetch(`/api/hod/classes/${classId}/faculty`, {
        method: 'POST',
        body: { facultyUserId: facultyChoice },
      })
      setAssignOpen(false)
      setFlash({ tone: 'success', text: 'Faculty assigned to this class.' })
      detail.reload()
    })
  }

  const confirmRemove = () => {
    const target = removing
    if (!target) {
      return
    }
    void remove.run(async () => {
      await apiFetch(`/api/hod/assignments/${target.id}/end`, { method: 'POST' })
      setRemoving(null)
      setFlash({ tone: 'success', text: `${target.fullName} removed from this class.` })
      detail.reload()
    })
  }

  const notFound = detail.error !== null && classId !== undefined

  return (
    <AppShell>
      <div className="mb-2">
        <Link to="/hod" className="text-sm font-medium text-indigo-600 hover:underline">
          ← Department overview
        </Link>
      </div>

      <PageHeader
        title={detail.data ? detail.data.class.name : 'Class faculty'}
        description={
          detail.data
            ? `${detail.data.class.department.name} · ${detail.data.class.academicYear} · ${detail.data.class.studentCount} students`
            : 'Assign and reassign faculty for this class.'
        }
        actions={
          detail.data ? (
            <Button variant="primary" onClick={openAssign}>
              Assign faculty
            </Button>
          ) : undefined
        }
      />

      {flash && (
        <Alert tone={flash.tone} className="mb-4">
          {flash.text}
        </Alert>
      )}
      {detail.error && <Alert className="mb-4">{detail.error}</Alert>}
      {detail.loading && <p className="text-sm text-slate-500">Loading class…</p>}

      {detail.data && (
        <>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Active faculty
          </h3>
          {detail.data.assignments.active.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-6 text-center text-sm text-slate-500">
              No faculty is currently assigned to this class.
            </p>
          ) : (
            <Table label="Active faculty assignments">
              <thead>
                <tr>
                  <Th>Faculty</Th>
                  <Th>Assigned</Th>
                  <Th>
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {detail.data.assignments.active.map((assignment) => (
                  <tr key={assignment.id}>
                    <Td>
                      <p className="font-medium text-slate-900">{assignment.fullName}</p>
                      <p className="text-xs text-slate-500">{assignment.email}</p>
                    </Td>
                    <Td className="whitespace-nowrap text-slate-600">
                      {formatDateTime(assignment.assignedAt)}
                    </Td>
                    <Td>
                      <div className="flex justify-end">
                        <Button
                          variant="ghost"
                          className="text-rose-600 hover:bg-rose-50"
                          onClick={() => {
                            remove.reset()
                            setRemoving(assignment)
                          }}
                        >
                          Remove
                        </Button>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}

          {detail.data.assignments.history.length > 0 && (
            <>
              <h3 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wide text-slate-500">
                Past assignments
              </h3>
              <Table label="Past faculty assignments">
                <thead>
                  <tr>
                    <Th>Faculty</Th>
                    <Th>Assigned</Th>
                    <Th>Unassigned</Th>
                  </tr>
                </thead>
                <tbody>
                  {detail.data.assignments.history.map((assignment) => (
                    <tr key={assignment.id}>
                      <Td>
                        <p className="text-slate-900">{assignment.fullName}</p>
                        <p className="text-xs text-slate-500">{assignment.email}</p>
                      </Td>
                      <Td className="whitespace-nowrap text-slate-600">
                        {formatDateTime(assignment.assignedAt)}
                      </Td>
                      <Td className="whitespace-nowrap text-slate-600">
                        {formatDateTime(assignment.unassignedAt)}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </>
          )}
        </>
      )}

      <Modal open={assignOpen} onClose={() => setAssignOpen(false)} title="Assign faculty">
        {facultyList.error && <Alert className="mb-4">{facultyList.error}</Alert>}
        {facultyList.loading && <p className="text-sm text-slate-500">Loading faculty…</p>}
        {facultyList.data && (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              submitAssign()
            }}
          >
            <SelectField
              id="assign-faculty"
              label="Faculty member"
              value={facultyChoice}
              onChange={(event) => setFacultyChoice(event.target.value)}
              error={assign.issues.facultyUserId}
              required
            >
              <option value="" disabled>
                Select a faculty member…
              </option>
              {eligibleFaculty.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.fullName} ({member.email})
                </option>
              ))}
            </SelectField>
            {eligibleFaculty.length === 0 && (
              <p className="text-xs text-slate-500">
                Every active faculty member is already assigned to this class.
              </p>
            )}
            {assign.error && <Alert>{assign.error}</Alert>}
            <div className="flex justify-end gap-2">
              <Button onClick={() => setAssignOpen(false)} disabled={assign.busy}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                loading={assign.busy}
                disabled={facultyChoice === ''}
              >
                Assign
              </Button>
            </div>
          </form>
        )}
      </Modal>

      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={confirmRemove}
        title={`Remove ${removing?.fullName ?? 'faculty'} from this class?`}
        message="The assignment ends today and is kept in the history. The faculty member loses access to this class's roster immediately."
        confirmLabel="Remove"
        danger
        busy={remove.busy}
        error={remove.error}
      />

      {notFound && (
        <p className="mt-2 text-xs text-slate-500">
          If this class belongs to another department, it is not visible from your account.
        </p>
      )}
    </AppShell>
  )
}
