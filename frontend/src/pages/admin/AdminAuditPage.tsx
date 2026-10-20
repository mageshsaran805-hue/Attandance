import { useState, type FormEvent } from 'react'
import AppShell from '../../components/AppShell'
import Alert from '../../components/ui/Alert'
import Button from '../../components/ui/Button'
import EmptyState from '../../components/ui/EmptyState'
import { SelectField, TextField } from '../../components/ui/FormField'
import PageHeader from '../../components/ui/PageHeader'
import { Table, Td, Th } from '../../components/ui/Table'
import type { AuditActionsResponse, AuditListResponse } from '../../lib/api-types'
import { formatDateTime } from '../../lib/format'
import { useFetch } from '../../lib/use-fetch'

const PAGE_SIZE = 25

interface Filters {
  action: string
  actorEmail: string
  from: string
  to: string
}

const EMPTY_FILTERS: Filters = { action: '', actorEmail: '', from: '', to: '' }

/**
 * Admin audit log: newest-first sensitive changes with before/after
 * snapshots. Filters are applied on submit so typing an email does not
 * refetch on every keystroke.
 */
export default function AdminAuditPage() {
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS)
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [page, setPage] = useState(1)

  const actions = useFetch<AuditActionsResponse>('/api/admin/audit/actions')

  const params = new URLSearchParams()
  if (filters.action) params.set('action', filters.action)
  if (filters.actorEmail.trim()) params.set('actorEmail', filters.actorEmail.trim())
  if (filters.from) params.set('from', filters.from)
  if (filters.to) params.set('to', filters.to)
  params.set('page', String(page))
  params.set('limit', String(PAGE_SIZE))

  const audit = useFetch<AuditListResponse>(`/api/admin/audit?${params.toString()}`)
  const total = audit.data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const applyFilters = (event: FormEvent) => {
    event.preventDefault()
    setFilters(draft)
    setPage(1)
  }

  const clearFilters = () => {
    setDraft(EMPTY_FILTERS)
    setFilters(EMPTY_FILTERS)
    setPage(1)
  }

  return (
    <AppShell>
      <PageHeader
        title="Audit log"
        description="Every sensitive change with its actor, before/after snapshot and IP address. Entries are append-only."
      />

      <form className="mb-6 flex flex-wrap items-end gap-3" onSubmit={applyFilters}>
        <div className="w-52">
          <SelectField
            id="audit-action"
            label="Action"
            value={draft.action}
            onChange={(event) => setDraft((current) => ({ ...current, action: event.target.value }))}
          >
            <option value="">All actions</option>
            {(actions.data?.actions ?? []).map((action) => (
              <option key={action} value={action}>
                {action}
              </option>
            ))}
          </SelectField>
        </div>
        <div className="w-56">
          <TextField
            id="audit-actor"
            label="Actor email"
            type="search"
            placeholder="contains…"
            value={draft.actorEmail}
            onChange={(event) =>
              setDraft((current) => ({ ...current, actorEmail: event.target.value }))
            }
          />
        </div>
        <div className="w-44">
          <TextField
            id="audit-from"
            label="From"
            type="date"
            value={draft.from}
            onChange={(event) => setDraft((current) => ({ ...current, from: event.target.value }))}
          />
        </div>
        <div className="w-44">
          <TextField
            id="audit-to"
            label="To"
            type="date"
            value={draft.to}
            onChange={(event) => setDraft((current) => ({ ...current, to: event.target.value }))}
          />
        </div>
        <Button type="submit" variant="primary">
          Apply filters
        </Button>
        <Button variant="ghost" onClick={clearFilters}>
          Clear
        </Button>
      </form>

      {audit.error && <Alert className="mb-4">{audit.error}</Alert>}
      {audit.loading && <p className="text-sm text-slate-500">Loading audit entries…</p>}

      {audit.data &&
        (audit.data.entries.length === 0 ? (
          <EmptyState
            title="No audit entries match"
            description="Widen the date range or clear the filters to see more."
          />
        ) : (
          <>
            <Table label="Audit log">
              <thead>
                <tr>
                  <Th>When</Th>
                  <Th>Actor</Th>
                  <Th>Action</Th>
                  <Th>Entity</Th>
                  <Th>Details</Th>
                </tr>
              </thead>
              <tbody>
                {audit.data.entries.map((entry) => (
                  <tr key={entry.id}>
                    <Td className="whitespace-nowrap">{formatDateTime(entry.createdAt)}</Td>
                    <Td>
                      {entry.actor ? (
                        <>
                          <p className="font-medium text-slate-900">{entry.actor.fullName}</p>
                          <p className="text-xs text-slate-500">{entry.actor.email}</p>
                        </>
                      ) : (
                        <span className="text-slate-500">Unauthenticated</span>
                      )}
                    </Td>
                    <Td>
                      <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700">
                        {entry.action}
                      </code>
                    </Td>
                    <Td>
                      <p className="text-slate-700">{entry.entityType}</p>
                      <p className="max-w-40 truncate text-xs text-slate-500" title={entry.entityId}>
                        {entry.entityId}
                      </p>
                    </Td>
                    <Td>
                      {entry.oldValue === null && entry.newValue === null ? (
                        <span className="text-slate-500">—</span>
                      ) : (
                        <details>
                          <summary className="cursor-pointer text-sm font-medium text-indigo-600">
                            View
                          </summary>
                          <pre className="mt-2 max-w-md overflow-x-auto rounded-lg bg-slate-50 p-2 text-xs text-slate-700">
                            {JSON.stringify(
                              { oldValue: entry.oldValue, newValue: entry.newValue },
                              null,
                              2,
                            )}
                          </pre>
                        </details>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-slate-500">
                Page {page} of {totalPages} · {total} {total === 1 ? 'entry' : 'entries'}
              </p>
              <div className="flex gap-2">
                <Button disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
                  ← Previous
                </Button>
                <Button
                  disabled={page >= totalPages}
                  onClick={() => setPage((value) => value + 1)}
                >
                  Next →
                </Button>
              </div>
            </div>
          </>
        ))}
    </AppShell>
  )
}
