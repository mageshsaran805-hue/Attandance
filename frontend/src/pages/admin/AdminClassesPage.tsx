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
import type { ClassListEntry, Department } from '../../lib/api-types'
import { useAction } from '../../lib/forms'
import { useFetch } from '../../lib/use-fetch'

interface ClassesResponse {
  classes: ClassListEntry[]
}

interface DepartmentsResponse {
  departments: Department[]
}

type Flash = { tone: 'success' | 'error'; text: string }

/**
 * Classes are created by administrators inside a department. A class cannot
 * be moved between departments after creation; it is renamed or given a new
 * academic year instead.
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

  return (
    <AppShell>
      <PageHeader
        title="Classes"
        description="Every class belongs to one department and one academic year. Faculty are assigned to classes by the department's HOD."
        actions={
          <Button variant="primary" onClick={openCreate}>
            New class
          </Button>
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
                    <div className="flex justify-end">
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
