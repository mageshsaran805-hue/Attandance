import { useState } from 'react'
import AppShell from '../../components/AppShell'
import Alert from '../../components/ui/Alert'
import Button from '../../components/ui/Button'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import EmptyState from '../../components/ui/EmptyState'
import { SelectField } from '../../components/ui/FormField'
import PageHeader from '../../components/ui/PageHeader'
import { Table, Td, Th } from '../../components/ui/Table'
import { apiFetch } from '../../lib/api'
import type {
  AdminRegistrationEntry,
  AdminRegistrationsResponse,
  RegistrationReviewResponse,
  RegistrationStatus,
} from '../../lib/api-types'
import { formatDateTime } from '../../lib/format'
import { useAction } from '../../lib/forms'
import { useFetch } from '../../lib/use-fetch'

type Flash = { tone: 'success' | 'error'; text: string }
type ReviewKind = 'approve' | 'reject'

const EMPTY_STATES: Record<RegistrationStatus, { title: string; description: string }> = {
  pending: {
    title: 'No pending registration requests',
    description: 'New student requests appear here for review.',
  },
  approved: {
    title: 'No approved registrations yet',
    description:
      'Approving a request creates the student account and enrolls it in the chosen class.',
  },
  rejected: {
    title: 'No rejected registrations',
    description: 'Rejected requests stay on record so the decision is traceable.',
  },
}

/**
 * Admin review queue for student self-registrations. Approving (single or
 * bulk) creates active student accounts with the passwords the students
 * chose and enrolls each one in the requested class.
 */
export default function AdminRegistrationsPage() {
  const [status, setStatus] = useState<RegistrationStatus>('pending')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [flash, setFlash] = useState<Flash | null>(null)
  const [confirm, setConfirm] = useState<{ kind: ReviewKind; ids: string[] } | null>(null)
  const review = useAction()

  const list = useFetch<AdminRegistrationsResponse>(`/api/admin/registrations?status=${status}`)
  const entries = list.data?.items ?? []
  const pending = status === 'pending'

  const toggleSelected = (id: string) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const allSelected = entries.length > 0 && entries.every((entry) => selected.has(entry.id))
  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(entries.map((entry) => entry.id)))
  }

  const changeStatus = (value: RegistrationStatus) => {
    setStatus(value)
    setSelected(new Set())
    setFlash(null)
  }

  const openConfirm = (kind: ReviewKind, ids: string[]) => {
    review.reset()
    setConfirm({ kind, ids })
  }

  const runReview = async () => {
    if (!confirm) {
      return
    }
    const { kind, ids } = confirm
    const names = new Map(entries.map((entry) => [entry.id, entry.fullName]))

    await review.run(async () => {
      const response = await apiFetch<RegistrationReviewResponse>(
        `/api/admin/registrations/${kind}`,
        { method: 'POST', body: { ids } },
      )
      const ok = response.results.filter((result) => result.ok).length
      const failures = response.results.filter((result) => !result.ok)
      const verb = kind === 'approve' ? 'Approved' : 'Rejected'

      if (failures.length === 0) {
        setFlash({
          tone: 'success',
          text: `${verb} ${ok} ${ok === 1 ? 'registration' : 'registrations'}.`,
        })
      } else {
        setFlash({
          tone: 'error',
          text: `${verb} ${ok} of ${response.results.length}. Failed: ${failures
            .map((failure) => `${names.get(failure.id) ?? failure.id} — ${failure.error ?? 'unknown error'}`)
            .join('; ')}`,
        })
      }

      setSelected(new Set())
      setConfirm(null)
      list.reload()
    })
  }

  const confirmCount = confirm?.ids.length ?? 0
  const confirmVerb = confirm?.kind === 'approve' ? 'Approve' : 'Reject'

  return (
    <AppShell>
      <PageHeader
        title="Student registrations"
        description="Requests from the public registration form. Approving creates the student account (with the password the student chose) and enrolls them in their chosen class; rejecting keeps the request on record."
      />

      {flash && (
        <Alert tone={flash.tone} className="mb-4">
          {flash.text}
        </Alert>
      )}

      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="w-full max-w-xs">
          <SelectField
            label="Show"
            id="registration-status"
            value={status}
            onChange={(event) => changeStatus(event.target.value as RegistrationStatus)}
          >
            <option value="pending">Pending requests</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </SelectField>
        </div>
        {list.data && (
          <p className="pb-2 text-sm text-slate-500">
            {list.data.total} {status} request{list.data.total === 1 ? '' : 's'}
          </p>
        )}
      </div>

      {list.error && (
        <Alert className="mb-4">
          <p>{list.error}</p>
          <button
            type="button"
            onClick={list.reload}
            className="mt-2 font-medium underline underline-offset-2"
          >
            Try again
          </button>
        </Alert>
      )}

      {pending && selected.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2">
          <span className="text-sm font-medium text-indigo-900">{selected.size} selected</span>
          <div className="flex gap-2">
            <Button variant="primary" onClick={() => openConfirm('approve', [...selected])}>
              Approve selected
            </Button>
            <Button variant="danger" onClick={() => openConfirm('reject', [...selected])}>
              Reject selected
            </Button>
          </div>
        </div>
      )}

      {!list.loading && !list.error && entries.length === 0 && (
        <EmptyState
          title={EMPTY_STATES[status].title}
          description={EMPTY_STATES[status].description}
        />
      )}

      {entries.length > 0 && (
        <>
          <Table label="Registration requests">
            <thead>
              <tr className="bg-slate-50">
                {pending && (
                  <Th className="w-10">
                    <input
                      type="checkbox"
                      aria-label="Select all requests on this page"
                      checked={allSelected}
                      onChange={toggleAll}
                    />
                  </Th>
                )}
                <Th>Name</Th>
                <Th>Email</Th>
                <Th>Register no.</Th>
                <Th>Phone</Th>
                <Th>Section</Th>
                <Th>Class</Th>
                <Th>Submitted</Th>
                {pending ? <Th>Actions</Th> : <Th>Reviewed</Th>}
              </tr>
            </thead>
            <tbody>
              {entries.map((entry: AdminRegistrationEntry) => (
                <tr key={entry.id} className="bg-white">
                  {pending && (
                    <Td>
                      <input
                        type="checkbox"
                        aria-label={`Select ${entry.fullName}`}
                        checked={selected.has(entry.id)}
                        onChange={() => toggleSelected(entry.id)}
                      />
                    </Td>
                  )}
                  <Td className="text-sm font-medium text-slate-900">{entry.fullName}</Td>
                  <Td className="text-slate-600">{entry.email}</Td>
                  <Td className="text-slate-600">{entry.registerNumber}</Td>
                  <Td className="text-slate-600">{entry.phone ?? '—'}</Td>
                  <Td className="text-slate-600">{entry.section ?? '—'}</Td>
                  <Td>
                    <div className="text-slate-700">{entry.class.name}</div>
                    <div className="text-xs text-slate-400">
                      {entry.class.department.name} · {entry.class.academicYear}
                    </div>
                  </Td>
                  <Td className="whitespace-nowrap text-slate-600">
                    {formatDateTime(entry.submittedAt)}
                  </Td>
                  {pending ? (
                    <Td>
                      <div className="flex gap-2">
                        <Button
                          variant="primary"
                          onClick={() => openConfirm('approve', [entry.id])}
                        >
                          Approve
                        </Button>
                        <Button variant="danger" onClick={() => openConfirm('reject', [entry.id])}>
                          Reject
                        </Button>
                      </div>
                    </Td>
                  ) : (
                    <Td>
                      <div className="text-slate-600">{formatDateTime(entry.reviewedAt)}</div>
                      <div className="text-xs text-slate-400">
                        {entry.reviewedBy?.fullName ?? '—'}
                      </div>
                      {entry.status === 'approved' && entry.createdUser && (
                        <div className="text-xs text-slate-400">
                          Account: {entry.createdUser.email}
                        </div>
                      )}
                    </Td>
                  )}
                </tr>
              ))}
            </tbody>
          </Table>

          {list.data && list.data.total > entries.length && (
            <p className="mt-3 text-sm text-slate-500">
              Showing the first {entries.length} of {list.data.total} requests.
            </p>
          )}
        </>
      )}

      <ConfirmDialog
        open={confirm !== null}
        onClose={() => {
          setConfirm(null)
          review.reset()
        }}
        onConfirm={() => void runReview()}
        title={`${confirmVerb} ${confirmCount} request${confirmCount === 1 ? '' : 's'}?`}
        message={
          confirm?.kind === 'approve'
            ? 'Each selected student gets an active account with the password they chose, and is enrolled in the class they picked. Accounts can be deactivated later if needed.'
            : 'Rejected students cannot sign in; they can submit a new registration request later. The request stays on record.'
        }
        confirmLabel={confirmVerb}
        danger={confirm?.kind === 'reject'}
        busy={review.busy}
        error={review.error}
      />
    </AppShell>
  )
}
