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
import type { AdminUser, Department } from '../../lib/api-types'
import { useAction } from '../../lib/forms'
import { useFetch } from '../../lib/use-fetch'

interface DepartmentsResponse {
  departments: Department[]
}

interface UsersResponse {
  users: AdminUser[]
}

type Flash = { tone: 'success' | 'error'; text: string }

/** Manage departments: create, rename, and assign the (single) HOD. */
export default function AdminDepartmentsPage() {
  const departments = useFetch<DepartmentsResponse>('/api/admin/departments')
  const [flash, setFlash] = useState<Flash | null>(null)

  // Create modal.
  const [createOpen, setCreateOpen] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createCode, setCreateCode] = useState('')
  const create = useAction()

  // Edit modal.
  const [editing, setEditing] = useState<Department | null>(null)
  const [editName, setEditName] = useState('')
  const [editCode, setEditCode] = useState('')
  const edit = useAction()

  // HOD assignment modal.
  const [assigning, setAssigning] = useState<Department | null>(null)
  const [hodChoice, setHodChoice] = useState('')
  const hodAction = useAction()
  const hods = useFetch<UsersResponse>(assigning ? '/api/admin/users?role=hod' : null)

  const openCreate = () => {
    create.reset()
    setCreateName('')
    setCreateCode('')
    setCreateOpen(true)
  }

  const submitCreate = () => {
    void create.run(async () => {
      await apiFetch('/api/admin/departments', {
        method: 'POST',
        body: { name: createName, code: createCode },
      })
      setCreateOpen(false)
      setFlash({ tone: 'success', text: `Department “${createName}” created.` })
      departments.reload()
    })
  }

  const openEdit = (department: Department) => {
    edit.reset()
    setEditing(department)
    setEditName(department.name)
    setEditCode(department.code)
  }

  const submitEdit = () => {
    const target = editing
    if (!target) {
      return
    }
    void edit.run(async () => {
      await apiFetch(`/api/admin/departments/${target.id}`, {
        method: 'PATCH',
        body: { name: editName, code: editCode },
      })
      setEditing(null)
      setFlash({ tone: 'success', text: `Department “${editName}” updated.` })
      departments.reload()
    })
  }

  const openHod = (department: Department) => {
    hodAction.reset()
    setAssigning(department)
    setHodChoice(department.hodUserId ?? '')
  }

  const submitHod = () => {
    const target = assigning
    if (!target) {
      return
    }
    void hodAction.run(async () => {
      await apiFetch(`/api/admin/departments/${target.id}/hod`, {
        method: 'PUT',
        body: { hodUserId: hodChoice === '' ? null : hodChoice },
      })
      setAssigning(null)
      setFlash({
        tone: 'success',
        text:
          hodChoice === ''
            ? `HOD cleared for ${target.name}.`
            : `HOD updated for ${target.name}.`,
      })
      departments.reload()
    })
  }

  return (
    <AppShell>
      <PageHeader
        title="Departments"
        description="Each department has one Head of Department. Assigning an HOD who already heads another department is rejected."
        actions={
          <Button variant="primary" onClick={openCreate}>
            New department
          </Button>
        }
      />

      {flash && (
        <Alert tone={flash.tone} className="mb-4">
          {flash.text}
        </Alert>
      )}
      {departments.error && <Alert className="mb-4">{departments.error}</Alert>}

      {departments.loading && <p className="text-sm text-slate-500">Loading departments…</p>}

      {departments.data &&
        (departments.data.departments.length === 0 ? (
          <EmptyState
            title="No departments yet"
            description="Create the first department to start building the college structure."
            action={
              <Button variant="primary" onClick={openCreate}>
                New department
              </Button>
            }
          />
        ) : (
          <Table label="Departments">
            <thead>
              <tr>
                <Th>Department</Th>
                <Th>Code</Th>
                <Th>HOD</Th>
                <Th className="text-right">Classes</Th>
                <Th className="text-right">Students</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {departments.data.departments.map((department) => (
                <tr key={department.id}>
                  <Td className="font-medium text-slate-900">{department.name}</Td>
                  <Td>{department.code}</Td>
                  <Td>
                    {department.hod ? (
                      <div>
                        <p>{department.hod.fullName}</p>
                        <p className="text-xs text-slate-500">{department.hod.email}</p>
                      </div>
                    ) : (
                      <span className="text-slate-400">Not assigned</span>
                    )}
                  </Td>
                  <Td className="text-right tabular-nums">{department.classCount}</Td>
                  <Td className="text-right tabular-nums">{department.studentCount}</Td>
                  <Td>
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" onClick={() => openEdit(department)}>
                        Edit
                      </Button>
                      <Button variant="ghost" onClick={() => openHod(department)}>
                        HOD
                      </Button>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ))}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New department">
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            submitCreate()
          }}
        >
          <TextField
            id="department-name"
            label="Department name"
            value={createName}
            onChange={(event) => setCreateName(event.target.value)}
            error={create.issues.name}
            placeholder="Computer Science and Engineering"
            required
            maxLength={100}
          />
          <TextField
            id="department-code"
            label="Code"
            value={createCode}
            onChange={(event) => setCreateCode(event.target.value)}
            error={create.issues.code}
            hint="Short code such as CSE — letters and digits only."
            required
            maxLength={10}
          />
          {create.error && <Alert>{create.error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button onClick={() => setCreateOpen(false)} disabled={create.busy}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={create.busy}>
              Create department
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={`Edit ${editing?.name ?? 'department'}`}
      >
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            submitEdit()
          }}
        >
          <TextField
            id="department-edit-name"
            label="Department name"
            value={editName}
            onChange={(event) => setEditName(event.target.value)}
            error={edit.issues.name}
            required
            maxLength={100}
          />
          <TextField
            id="department-edit-code"
            label="Code"
            value={editCode}
            onChange={(event) => setEditCode(event.target.value)}
            error={edit.issues.code}
            required
            maxLength={10}
          />
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

      <Modal
        open={assigning !== null}
        onClose={() => setAssigning(null)}
        title={`HOD for ${assigning?.name ?? 'department'}`}
      >
        {hods.error && <Alert className="mb-4">{hods.error}</Alert>}
        {hods.loading && <p className="text-sm text-slate-500">Loading HOD accounts…</p>}
        {hods.data && (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              submitHod()
            }}
          >
            <SelectField
              id="department-hod"
              label="Head of Department"
              value={hodChoice}
              onChange={(event) => setHodChoice(event.target.value)}
            >
              <option value="">— No HOD —</option>
              {hods.data.users.map((hodUser) => (
                <option key={hodUser.id} value={hodUser.id}>
                  {hodUser.fullName} ({hodUser.email})
                </option>
              ))}
            </SelectField>
            <p className="text-xs text-slate-500">
              Each HOD can head only one department. HOD accounts are created on the Accounts
              page.
            </p>
            {hodAction.error && <Alert>{hodAction.error}</Alert>}
            <div className="flex justify-end gap-2">
              <Button onClick={() => setAssigning(null)} disabled={hodAction.busy}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" loading={hodAction.busy}>
                Save HOD
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </AppShell>
  )
}
