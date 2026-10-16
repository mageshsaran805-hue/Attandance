import { useState } from 'react'
import AppShell from '../../components/AppShell'
import Alert from '../../components/ui/Alert'
import Badge from '../../components/ui/Badge'
import Button from '../../components/ui/Button'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import EmptyState from '../../components/ui/EmptyState'
import { SelectField, TextField } from '../../components/ui/FormField'
import Modal from '../../components/ui/Modal'
import PageHeader from '../../components/ui/PageHeader'
import { Table, Td, Th } from '../../components/ui/Table'
import { ApiRequestError, apiFetch } from '../../lib/api'
import type { AdminUser } from '../../lib/api-types'
import { useAuth } from '../../lib/auth-context'
import { formatDate } from '../../lib/format'
import { useAction } from '../../lib/forms'
import { ROLE_LABELS, type UserRole } from '../../lib/roles'
import { useFetch } from '../../lib/use-fetch'

interface UsersResponse {
  users: AdminUser[]
}

type Flash = { tone: 'success' | 'error'; text: string }
type CreatableRole = 'admin' | 'hod' | 'faculty'

const ROLE_TONES: Record<UserRole, 'info' | 'muted' | 'warning'> = {
  admin: 'warning',
  hod: 'info',
  faculty: 'info',
  student: 'muted',
}

/**
 * System-wide account administration: create, edit, change role, reset
 * password, activate/deactivate. Role changes are rejected by the backend
 * while active class/enrollment records exist, and the admin cannot change or
 * deactivate their own account.
 */
export default function AdminUsersPage() {
  const { user: me } = useAuth()

  const [roleFilter, setRoleFilter] = useState('')
  const [searchDraft, setSearchDraft] = useState('')
  const [search, setSearch] = useState('')
  const [includeInactive, setIncludeInactive] = useState(false)

  const query = new URLSearchParams()
  if (roleFilter) {
    query.set('role', roleFilter)
  }
  if (search) {
    query.set('search', search)
  }
  if (includeInactive) {
    query.set('includeInactive', 'true')
  }
  const queryString = query.toString()
  const users = useFetch<UsersResponse>(`/api/admin/users${queryString ? `?${queryString}` : ''}`)

  const [flash, setFlash] = useState<Flash | null>(null)

  // Create modal.
  const [createOpen, setCreateOpen] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createEmail, setCreateEmail] = useState('')
  const [createRole, setCreateRole] = useState<CreatableRole>('faculty')
  const [createPassword, setCreatePassword] = useState('')
  const create = useAction()

  // Edit modal.
  const [editing, setEditing] = useState<AdminUser | null>(null)
  const [editName, setEditName] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const edit = useAction()

  // Role modal.
  const [roleTarget, setRoleTarget] = useState<AdminUser | null>(null)
  const [roleChoice, setRoleChoice] = useState<UserRole>('faculty')
  const roleChange = useAction()

  // Password reset modal.
  const [resetTarget, setResetTarget] = useState<AdminUser | null>(null)
  const [newPassword, setNewPassword] = useState('')
  const resetAction = useAction()

  // Deactivate confirmation.
  const [deactivateTarget, setDeactivateTarget] = useState<AdminUser | null>(null)
  const statusAction = useAction()
  const [activateBusyId, setActivateBusyId] = useState<string | null>(null)

  const openCreate = () => {
    create.reset()
    setCreateName('')
    setCreateEmail('')
    setCreateRole('faculty')
    setCreatePassword('')
    setCreateOpen(true)
  }

  const submitCreate = () => {
    void create.run(async () => {
      const result = await apiFetch<{ user: AdminUser }>('/api/admin/users', {
        method: 'POST',
        body: {
          fullName: createName,
          email: createEmail,
          role: createRole,
          password: createPassword,
        },
      })
      setCreateOpen(false)
      setFlash({ tone: 'success', text: `Account for ${result.user.fullName} created.` })
      users.reload()
    })
  }

  const openEdit = (target: AdminUser) => {
    edit.reset()
    setEditing(target)
    setEditName(target.fullName)
    setEditEmail(target.email)
  }

  const submitEdit = () => {
    const target = editing
    if (!target) {
      return
    }
    void edit.run(async () => {
      await apiFetch(`/api/admin/users/${target.id}`, {
        method: 'PATCH',
        body: { fullName: editName, email: editEmail },
      })
      setEditing(null)
      setFlash({ tone: 'success', text: `Account ${editName} updated.` })
      users.reload()
    })
  }

  const openRole = (target: AdminUser) => {
    roleChange.reset()
    setRoleTarget(target)
    setRoleChoice(target.role)
  }

  const submitRole = () => {
    const target = roleTarget
    if (!target) {
      return
    }
    void roleChange.run(async () => {
      await apiFetch(`/api/admin/users/${target.id}/role`, {
        method: 'POST',
        body: { role: roleChoice },
      })
      setRoleTarget(null)
      setFlash({
        tone: 'success',
        text: `${target.fullName} is now ${ROLE_LABELS[roleChoice].toLowerCase()}.`,
      })
      users.reload()
    })
  }

  const openReset = (target: AdminUser) => {
    resetAction.reset()
    setResetTarget(target)
    setNewPassword('')
  }

  const submitReset = () => {
    const target = resetTarget
    if (!target) {
      return
    }
    void resetAction.run(async () => {
      await apiFetch(`/api/admin/users/${target.id}/reset-password`, {
        method: 'POST',
        body: { newPassword },
      })
      setResetTarget(null)
      setFlash({
        tone: 'success',
        text: `Password reset for ${target.fullName}. Share the new password safely.`,
      })
    })
  }

  const confirmDeactivate = () => {
    const target = deactivateTarget
    if (!target) {
      return
    }
    void statusAction.run(async () => {
      await apiFetch(`/api/admin/users/${target.id}/status`, {
        method: 'POST',
        body: { isActive: false },
      })
      setDeactivateTarget(null)
      setFlash({ tone: 'success', text: `${target.fullName} deactivated.` })
      users.reload()
    })
  }

  const activate = (target: AdminUser) => {
    setActivateBusyId(target.id)
    void (async () => {
      try {
        await apiFetch(`/api/admin/users/${target.id}/status`, {
          method: 'POST',
          body: { isActive: true },
        })
        setFlash({ tone: 'success', text: `${target.fullName} reactivated.` })
        users.reload()
      } catch (cause) {
        setFlash({
          tone: 'error',
          text:
            cause instanceof ApiRequestError
              ? cause.message
              : 'Could not reach the server. Try again.',
        })
      } finally {
        setActivateBusyId(null)
      }
    })()
  }

  return (
    <AppShell>
      <PageHeader
        title="Accounts"
        description="Administrators, HODs and faculty accounts. Student accounts are created by faculty from their class rosters."
        actions={
          <Button variant="primary" onClick={openCreate}>
            New account
          </Button>
        }
      />

      {flash && (
        <Alert tone={flash.tone} className="mb-4">
          {flash.text}
        </Alert>
      )}

      <form
        className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
        onSubmit={(event) => {
          event.preventDefault()
          setSearch(searchDraft.trim())
        }}
      >
        <div className="w-44">
          <SelectField
            id="user-role-filter"
            label="Role"
            value={roleFilter}
            onChange={(event) => setRoleFilter(event.target.value)}
          >
            <option value="">All roles</option>
            <option value="admin">Administrators</option>
            <option value="hod">Heads of Department</option>
            <option value="faculty">Faculty</option>
            <option value="student">Students</option>
          </SelectField>
        </div>
        <div className="min-w-52 flex-1">
          <TextField
            id="user-search"
            label="Search"
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            placeholder="Name or email"
          />
        </div>
        <label className="flex items-center gap-2 pb-2.5 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(event) => setIncludeInactive(event.target.checked)}
            className="size-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-600"
          />
          Include deactivated
        </label>
        <Button type="submit" className="mb-0.5">
          Apply
        </Button>
        {(roleFilter !== '' || search !== '' || includeInactive) && (
          <Button
            variant="ghost"
            className="mb-0.5"
            onClick={() => {
              setRoleFilter('')
              setSearchDraft('')
              setSearch('')
              setIncludeInactive(false)
            }}
          >
            Clear
          </Button>
        )}
      </form>

      {users.error && <Alert className="mb-4">{users.error}</Alert>}
      {users.loading && <p className="text-sm text-slate-500">Loading accounts…</p>}

      {users.data &&
        (users.data.users.length === 0 ? (
          <EmptyState
            title="No accounts match"
            description="Try clearing the filters, or create a new account."
          />
        ) : (
          <Table label="Accounts">
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Email</Th>
                <Th>Role</Th>
                <Th>Status</Th>
                <Th>Created</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {users.data.users.map((account) => {
                const isSelf = account.id === me?.id
                return (
                  <tr key={account.id}>
                    <Td className="font-medium text-slate-900">
                      {account.fullName}
                      {isSelf && <span className="ml-2 text-xs text-slate-400">(you)</span>}
                    </Td>
                    <Td className="text-slate-600">{account.email}</Td>
                    <Td>
                      <Badge tone={ROLE_TONES[account.role]}>{ROLE_LABELS[account.role]}</Badge>
                    </Td>
                    <Td>
                      {account.isActive ? (
                        <Badge tone="success">Active</Badge>
                      ) : (
                        <Badge tone="muted">Deactivated</Badge>
                      )}
                    </Td>
                    <Td className="whitespace-nowrap text-slate-600">{formatDate(account.createdAt)}</Td>
                    <Td>
                      <div className="flex justify-end gap-0.5">
                        <Button variant="ghost" onClick={() => openEdit(account)}>
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => openRole(account)}
                          disabled={isSelf}
                          title={isSelf ? 'You cannot change your own role' : undefined}
                        >
                          Role
                        </Button>
                        <Button variant="ghost" onClick={() => openReset(account)}>
                          Reset password
                        </Button>
                        {account.isActive ? (
                          <Button
                            variant="ghost"
                            className="text-rose-600 hover:bg-rose-50"
                            onClick={() => {
                              statusAction.reset()
                              setDeactivateTarget(account)
                            }}
                            disabled={isSelf}
                            title={isSelf ? 'You cannot deactivate your own account' : undefined}
                          >
                            Deactivate
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            onClick={() => activate(account)}
                            loading={activateBusyId === account.id}
                          >
                            Activate
                          </Button>
                        )}
                      </div>
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </Table>
        ))}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New account">
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            submitCreate()
          }}
        >
          <TextField
            id="account-name"
            label="Full name"
            value={createName}
            onChange={(event) => setCreateName(event.target.value)}
            error={create.issues.fullName}
            required
            maxLength={120}
          />
          <TextField
            id="account-email"
            label="Email"
            type="email"
            value={createEmail}
            onChange={(event) => setCreateEmail(event.target.value)}
            error={create.issues.email}
            required
          />
          <SelectField
            id="account-role"
            label="Role"
            value={createRole}
            onChange={(event) => setCreateRole(event.target.value as CreatableRole)}
            error={create.issues.role}
          >
            <option value="faculty">Faculty</option>
            <option value="hod">Head of Department</option>
            <option value="admin">Administrator</option>
          </SelectField>
          <TextField
            id="account-password"
            label="Initial password"
            type="password"
            value={createPassword}
            onChange={(event) => setCreatePassword(event.target.value)}
            error={create.issues.password}
            hint="At least 8 characters with a letter and a number. The owner can keep or change it."
            required
            autoComplete="new-password"
          />
          {create.error && <Alert>{create.error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button onClick={() => setCreateOpen(false)} disabled={create.busy}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={create.busy}>
              Create account
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={`Edit ${editing?.fullName ?? 'account'}`}
      >
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            submitEdit()
          }}
        >
          <TextField
            id="account-edit-name"
            label="Full name"
            value={editName}
            onChange={(event) => setEditName(event.target.value)}
            error={edit.issues.fullName}
            required
            maxLength={120}
          />
          <TextField
            id="account-edit-email"
            label="Email"
            type="email"
            value={editEmail}
            onChange={(event) => setEditEmail(event.target.value)}
            error={edit.issues.email}
            required
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
        open={roleTarget !== null}
        onClose={() => setRoleTarget(null)}
        title={`Role for ${roleTarget?.fullName ?? 'account'}`}
      >
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            submitRole()
          }}
        >
          <SelectField
            id="account-role-change"
            label="Role"
            value={roleChoice}
            onChange={(event) => setRoleChoice(event.target.value as UserRole)}
          >
            <option value="admin">Administrator</option>
            <option value="hod">Head of Department</option>
            <option value="faculty">Faculty</option>
            <option value="student">Student</option>
          </SelectField>
          <p className="text-xs text-slate-500">
            Role changes are refused while the account holds active records — a headed department,
            class assignments, or class enrollments. Clear those first.
          </p>
          {roleChange.error && <Alert>{roleChange.error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button onClick={() => setRoleTarget(null)} disabled={roleChange.busy}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={roleChange.busy}>
              Change role
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={resetTarget !== null}
        onClose={() => setResetTarget(null)}
        title={`Reset password for ${resetTarget?.fullName ?? 'account'}`}
      >
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            submitReset()
          }}
        >
          <TextField
            id="account-new-password"
            label="New password"
            type="password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            error={resetAction.issues.newPassword}
            hint="At least 8 characters with a letter and a number."
            required
            autoComplete="new-password"
          />
          {resetAction.error && <Alert>{resetAction.error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button onClick={() => setResetTarget(null)} disabled={resetAction.busy}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={resetAction.busy}>
              Reset password
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={deactivateTarget !== null}
        onClose={() => setDeactivateTarget(null)}
        onConfirm={confirmDeactivate}
        title={`Deactivate ${deactivateTarget?.fullName ?? 'account'}?`}
        message="The account is signed out on its next request and cannot sign in again until an administrator reactivates it. Attendance history and audit records are kept."
        confirmLabel="Deactivate"
        danger
        busy={statusAction.busy}
        error={statusAction.error}
      />
    </AppShell>
  )
}
