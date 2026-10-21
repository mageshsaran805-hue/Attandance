import { useState } from 'react'
import AppShell from '../../components/AppShell'
import Alert from '../../components/ui/Alert'
import Button from '../../components/ui/Button'
import EmptyState from '../../components/ui/EmptyState'
import { SelectField, TextField } from '../../components/ui/FormField'
import Modal from '../../components/ui/Modal'
import PageHeader from '../../components/ui/PageHeader'
import { Table, Td, Th } from '../../components/ui/Table'
import { apiFetch } from '../../lib/api'
import type {
  ClassListEntry,
  Department,
  PromotionResponse,
  PromotionResult,
} from '../../lib/api-types'
import { useAction } from '../../lib/forms'
import { useFetch } from '../../lib/use-fetch'

interface ClassesResponse {
  classes: ClassListEntry[]
}

interface DepartmentsResponse {
  departments: Department[]
}

type Flash = { tone: 'success' | 'error'; text: string }

function studentCount(count: number): string {
  return `${count} ${count === 1 ? 'student' : 'students'}`
}

function promotionFlash(result: PromotionResult): string {
  const source = `“${result.sourceClass.name}” (${result.sourceClass.academicYear})`
  const target = `“${result.targetClass.name}” (${result.targetClass.academicYear})`
  const parts: string[] = []
  if (result.promotedCount > 0) {
    parts.push(`Promoted ${studentCount(result.promotedCount)} from ${source} to ${target}.`)
  } else {
    parts.push(
      `Finished promotion from ${source} to ${target} — no new target enrollments were needed.`,
    )
  }
  if (result.alreadyEnrolledCount > 0) {
    parts.push(
      `${studentCount(result.alreadyEnrolledCount)} ${result.alreadyEnrolledCount === 1 ? 'was' : 'were'} already in the target class.`,
    )
  }
  if (result.skippedInactiveCount > 0) {
    const inactive = result.skippedInactiveCount === 1 ? 'an inactive account' : 'inactive accounts'
    parts.push(
      `${studentCount(result.skippedInactiveCount)} with ${inactive} ${result.skippedInactiveCount === 1 ? 'was' : 'were'} skipped and left in the source class.`,
    )
  }
  return parts.join(' ')
}

/**
 * Classes are created by administrators inside a department. A class cannot
 * be moved between departments after creation; it is renamed or given a new
 * academic year instead. At year end, administrators can promote all active
 * students from one class to another class in the same department; the source
 * enrollment history is kept.
 */
export default function AdminClassesPage() {
  const classes = useFetch<ClassesResponse>('/api/admin/classes')
  const [flash, setFlash] = useState<Flash | null>(null)

  // Create modal (departments load on demand).
  const [createOpen, setCreateOpen] = useState(false)
  const [createDepartmentId, setCreateDepartmentId] = useState('')
  const [createName, setCreateName] = useState('')
  const [createYear, setCreateYear] = useState('')
  const create = useAction()
  const departments = useFetch<DepartmentsResponse>(createOpen ? '/api/admin/departments' : null)

  // Edit modal.
  const [editing, setEditing] = useState<ClassListEntry | null>(null)
  const [editName, setEditName] = useState('')
  const [editYear, setEditYear] = useState('')
  const edit = useAction()

  // Promote modal.
  const [promoteOpen, setPromoteOpen] = useState(false)
  const [promoteSourceId, setPromoteSourceId] = useState('')
  const [promoteTargetId, setPromoteTargetId] = useState('')
  const promote = useAction()

  const promoteSource =
    classes.data?.classes.find((entry) => entry.id === promoteSourceId) ?? null
  const promoteTargets = promoteSource
    ? (classes.data?.classes ?? []).filter(
        (entry) =>
          entry.department.id === promoteSource.department.id && entry.id !== promoteSource.id,
      )
    : []
  const promoteTarget =
    promoteTargets.find((entry) => entry.id === promoteTargetId) ?? null

  const openCreate = () => {
    create.reset()
    setCreateDepartmentId('')
    setCreateName('')
    setCreateYear('')
    setCreateOpen(true)
  }

  const submitCreate = () => {
    void create.run(async () => {
      await apiFetch('/api/admin/classes', {
        method: 'POST',
        body: {
          departmentId: createDepartmentId,
          name: createName,
          academicYear: createYear,
        },
      })
      setCreateOpen(false)
      setFlash({ tone: 'success', text: `Class “${createName}” created.` })
      classes.reload()
    })
  }

  const openEdit = (target: ClassListEntry) => {
    edit.reset()
    setEditing(target)
    setEditName(target.name)
    setEditYear(target.academicYear)
  }

  const submitEdit = () => {
    const target = editing
    if (!target) {
      return
    }
    void edit.run(async () => {
      await apiFetch(`/api/admin/classes/${target.id}`, {
        method: 'PATCH',
        body: { name: editName, academicYear: editYear },
      })
      setEditing(null)
      setFlash({ tone: 'success', text: `Class “${editName}” updated.` })
      classes.reload()
    })
  }

  const openPromote = (source?: ClassListEntry) => {
    promote.reset()
    setPromoteSourceId(source?.id ?? '')
    setPromoteTargetId('')
    setPromoteOpen(true)
  }

  const submitPromote = () => {
    const source = promoteSource
    if (!source || !promoteTarget) {
      return
    }
    void promote.run(async () => {
      const response = await apiFetch<PromotionResponse>(
        `/api/admin/classes/${source.id}/promote`,
        {
          method: 'POST',
          body: { targetClassId: promoteTarget.id },
        },
      )
      setPromoteOpen(false)
      setFlash({ tone: 'success', text: promotionFlash(response.promotion) })
      classes.reload()
    })
  }

  return (
    <AppShell>
      <PageHeader
        title="Classes"
        description="Every class belongs to one department and one academic year. At the end of a year, promote students into the next class in the same department."
        actions={
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              onClick={() => openPromote()}
              disabled={!classes.data || classes.data.classes.length === 0}
            >
              Promote students
            </Button>
            <Button variant="primary" onClick={openCreate}>
              New class
            </Button>
          </div>
        }
      />

      {flash && (
        <Alert tone={flash.tone} className="mb-4">
          {flash.text}
        </Alert>
      )}
      {classes.error && <Alert className="mb-4">{classes.error}</Alert>}
      {classes.loading && <p className="text-sm text-slate-500">Loading classes…</p>}

      {classes.data &&
        (classes.data.classes.length === 0 ? (
          <EmptyState
            title="No classes yet"
            description="Create a class inside a department to start enrolling students."
            action={
              <Button variant="primary" onClick={openCreate}>
                New class
              </Button>
            }
          />
        ) : (
          <Table label="Classes">
            <thead>
              <tr>
                <Th>Class</Th>
                <Th>Academic year</Th>
                <Th>Department</Th>
                <Th className="text-right">Students</Th>
                <Th className="text-right">Faculty</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {classes.data.classes.map((entry) => (
                <tr key={entry.id}>
                  <Td className="font-medium text-slate-900">{entry.name}</Td>
                  <Td>{entry.academicYear}</Td>
                  <Td>
                    <p>{entry.department.name}</p>
                    <p className="text-xs text-slate-500">{entry.department.code}</p>
                  </Td>
                  <Td className="text-right tabular-nums">{entry.studentCount}</Td>
                  <Td className="text-right tabular-nums">{entry.facultyCount}</Td>
                  <Td>
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" onClick={() => openPromote(entry)}>
                        Promote
                      </Button>
                      <Button variant="ghost" onClick={() => openEdit(entry)}>
                        Edit
                      </Button>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ))}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New class">
        {departments.error && <Alert className="mb-4">{departments.error}</Alert>}
        {departments.loading && <p className="text-sm text-slate-500">Loading departments…</p>}
        {departments.data && (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              submitCreate()
            }}
          >
            <SelectField
              id="class-department"
              label="Department"
              value={createDepartmentId}
              onChange={(event) => setCreateDepartmentId(event.target.value)}
              error={create.issues.departmentId}
              required
            >
              <option value="" disabled>
                Select a department…
              </option>
              {departments.data.departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name} ({department.code})
                </option>
              ))}
            </SelectField>
            <TextField
              id="class-name"
              label="Class name"
              value={createName}
              onChange={(event) => setCreateName(event.target.value)}
              error={create.issues.name}
              placeholder="3rd Year — Section A"
              required
              maxLength={120}
            />
            <TextField
              id="class-year"
              label="Academic year"
              value={createYear}
              onChange={(event) => setCreateYear(event.target.value)}
              error={create.issues.academicYear}
              hint="Format: 2026-27"
              placeholder="2026-27"
              required
            />
            {create.error && <Alert>{create.error}</Alert>}
            <div className="flex justify-end gap-2">
              <Button onClick={() => setCreateOpen(false)} disabled={create.busy}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" loading={create.busy}>
                Create class
              </Button>
            </div>
          </form>
        )}
      </Modal>

      <Modal
        open={promoteOpen}
        onClose={() => setPromoteOpen(false)}
        title="Promote students"
      >
        {!classes.data ? (
          <p className="text-sm text-slate-500">{classes.error ?? 'Loading classes…'}</p>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              submitPromote()
            }}
          >
            <SelectField
              id="promote-source"
              label="From class"
              value={promoteSourceId}
              onChange={(event) => {
                promote.reset()
                setPromoteSourceId(event.target.value)
                setPromoteTargetId('')
              }}
              error={promote.issues.sourceClassId}
              required
            >
              <option value="" disabled>
                Select the class students are leaving…
              </option>
              {classes.data.classes.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name} — {entry.academicYear} ({entry.department.code})
                </option>
              ))}
            </SelectField>

            <SelectField
              id="promote-target"
              label="To class"
              value={promoteTargetId}
              onChange={(event) => {
                promote.reset()
                setPromoteTargetId(event.target.value)
              }}
              error={promote.issues.targetClassId}
              disabled={!promoteSource}
              required
            >
              <option value="" disabled>
                Select the next class…
              </option>
              {promoteTargets.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name} — {entry.academicYear} ({entry.department.code})
                </option>
              ))}
            </SelectField>

            {promoteSource && promoteTargets.length === 0 && (
              <Alert tone="info">
                There is no other class in {promoteSource.department.name}. Create the next
                class first, then return here to promote students.
              </Alert>
            )}

            {promoteSource && promoteSource.studentCount === 0 && (
              <Alert tone="info">This class has no enrolled students to promote.</Alert>
            )}

            {promoteSource && promoteTarget && (
              <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-4 text-sm text-slate-700">
                <p className="font-medium text-slate-900">Promotion summary</p>
                <p className="mt-1">
                  {promoteSource.name} has {studentCount(promoteSource.studentCount)} enrolled.
                  Active students will leave the source class and join {promoteTarget.name}.
                </p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-600">
                  <li>Attendance and enrollment history are preserved.</li>
                  <li>Students already in the target class only leave the source class.</li>
                  <li>Inactive student accounts are skipped and left in the source class.</li>
                  <li>Open attendance sessions in either class must be closed first.</li>
                </ul>
              </div>
            )}

            {promote.error && <Alert>{promote.error}</Alert>}

            <div className="flex justify-end gap-2">
              <Button onClick={() => setPromoteOpen(false)} disabled={promote.busy}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                loading={promote.busy}
                disabled={!promoteSource || !promoteTarget || promoteSource.studentCount === 0}
              >
                Promote students
              </Button>
            </div>
          </form>
        )}
      </Modal>

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={`Edit ${editing?.name ?? 'class'}`}
      >
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            submitEdit()
          }}
        >
          <TextField
            id="class-edit-name"
            label="Class name"
            value={editName}
            onChange={(event) => setEditName(event.target.value)}
            error={edit.issues.name}
            required
            maxLength={120}
          />
          <TextField
            id="class-edit-year"
            label="Academic year"
            value={editYear}
            onChange={(event) => setEditYear(event.target.value)}
            error={edit.issues.academicYear}
            hint="Format: 2026-27"
            required
          />
          <p className="text-xs text-slate-500">
            A class stays in its department for life; create a new class to move to another
            department.
          </p>
          {edit.error && <Alert>{edit.error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button onClick={() => setEditing(null)} disabled={edit.busy}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={edit.busy}>
              Save changes
            </Button>
          </div>
        </form>
      </Modal>
    </AppShell>
  )
}
