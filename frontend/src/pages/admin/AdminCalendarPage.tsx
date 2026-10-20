import { useState } from 'react'
import AppShell from '../../components/AppShell'
import Alert from '../../components/ui/Alert'
import Badge from '../../components/ui/Badge'
import Button from '../../components/ui/Button'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import EmptyState from '../../components/ui/EmptyState'
import { TextField } from '../../components/ui/FormField'
import Modal from '../../components/ui/Modal'
import PageHeader from '../../components/ui/PageHeader'
import { Table, Td, Th } from '../../components/ui/Table'
import { apiFetch } from '../../lib/api'
import type { NonWorkingDay, NonWorkingDaysResponse } from '../../lib/api-types'
import { formatDate, todayIso } from '../../lib/format'
import { useAction } from '../../lib/forms'
import { useFetch } from '../../lib/use-fetch'

type Flash = { tone: 'success' | 'error'; text: string }

function weekdayOf(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-IN', {
    weekday: 'long',
    timeZone: 'UTC',
  })
}

/**
 * College calendar: non-working days (holidays). The dates are informational —
 * students see them in their calendar view and faculty are asked to confirm
 * before opening a session on one — but they never change attendance math,
 * because a holiday normally has no session at all.
 */
export default function AdminCalendarPage() {
  const [year, setYear] = useState(() => Number(todayIso().slice(0, 4)))
  const days = useFetch<NonWorkingDaysResponse>(
    `/api/calendar/non-working-days?from=${year}-01-01&to=${year}-12-31`,
  )
  const [flash, setFlash] = useState<Flash | null>(null)

  // Add modal.
  const [addOpen, setAddOpen] = useState(false)
  const [addDay, setAddDay] = useState('')
  const [addLabel, setAddLabel] = useState('')
  const add = useAction()

  // Remove confirmation.
  const [removing, setRemoving] = useState<NonWorkingDay | null>(null)
  const remove = useAction()

  const today = todayIso()

  const openAdd = () => {
    add.reset()
    setAddDay('')
    setAddLabel('')
    setAddOpen(true)
  }

  const submitAdd = () => {
    void add.run(async () => {
      await apiFetch('/api/admin/calendar', {
        method: 'POST',
        body: { day: addDay, label: addLabel },
      })
      setAddOpen(false)
      setFlash({ tone: 'success', text: `${formatDate(addDay)} marked as non-working.` })
      days.reload()
    })
  }

  const confirmRemove = () => {
    const target = removing
    if (!target) {
      return
    }
    void remove.run(async () => {
      await apiFetch(`/api/admin/calendar/${target.id}`, { method: 'DELETE' })
      setRemoving(null)
      setFlash({ tone: 'success', text: `${formatDate(target.day)} is a working day again.` })
      days.reload()
    })
  }

  return (
    <AppShell>
      <PageHeader
        title="College calendar"
        description="Non-working days shown to students and faculty. Opening a session on one is allowed after a warning, and reports are unaffected because holidays normally have no session."
        actions={
          <Button variant="primary" onClick={openAdd}>
            New non-working day
          </Button>
        }
      />

      {flash && (
        <Alert tone={flash.tone} className="mb-4">
          {flash.text}
        </Alert>
      )}
      {days.error && <Alert className="mb-4">{days.error}</Alert>}

      <div className="mb-4 flex items-center gap-2">
        <Button variant="ghost" aria-label="Previous year" onClick={() => setYear(year - 1)}>
          ←
        </Button>
        <span className="min-w-20 text-center text-sm font-semibold text-slate-700">{year}</span>
        <Button variant="ghost" aria-label="Next year" onClick={() => setYear(year + 1)}>
          →
        </Button>
        {days.data && (
          <span className="text-sm text-slate-500">
            {days.data.nonWorkingDays.length}{' '}
            {days.data.nonWorkingDays.length === 1 ? 'entry' : 'entries'}
          </span>
        )}
      </div>

      {days.loading && <p className="text-sm text-slate-500">Loading calendar…</p>}

      {days.data &&
        (days.data.nonWorkingDays.length === 0 ? (
          <EmptyState
            title={`No non-working days in ${year}`}
            description="Add holidays, festival days and other closures here. Students see them in their attendance calendar."
            action={
              <Button variant="primary" onClick={openAdd}>
                New non-working day
              </Button>
            }
          />
        ) : (
          <Table label="Non-working days">
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Day</Th>
                <Th>Label</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {days.data.nonWorkingDays.map((entry) => (
                <tr key={entry.id} className={entry.day < today ? 'text-slate-500' : undefined}>
                  <Td className="whitespace-nowrap font-medium">
                    <span className={entry.day < today ? '' : 'text-slate-900'}>
                      {formatDate(entry.day)}
                    </span>
                    {entry.day === today && (
                      <span className="ml-2">
                        <Badge tone="info">Today</Badge>
                      </span>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap">{weekdayOf(entry.day)}</Td>
                  <Td>{entry.label}</Td>
                  <Td>
                    <div className="flex justify-end">
                      <Button
                        variant="ghost"
                        className="text-rose-600 hover:bg-rose-50"
                        onClick={() => {
                          remove.reset()
                          setRemoving(entry)
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
        ))}

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="New non-working day">
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            submitAdd()
          }}
        >
          <TextField
            id="calendar-day"
            label="Date"
            type="date"
            value={addDay}
            onChange={(event) => setAddDay(event.target.value)}
            error={add.issues.day}
            required
          />
          <TextField
            id="calendar-label"
            label="Label"
            value={addLabel}
            onChange={(event) => setAddLabel(event.target.value)}
            error={add.issues.label}
            placeholder="Diwali holiday"
            hint="Shown to students and faculty, e.g. the reason for the holiday."
            required
            maxLength={120}
          />
          {add.error && <Alert>{add.error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button onClick={() => setAddOpen(false)} disabled={add.busy}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={add.busy}>
              Add non-working day
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={confirmRemove}
        title={`Remove ${removing ? formatDate(removing.day) : 'this day'}?`}
        message={`“${removing?.label ?? ''}” is removed from the calendar. The day becomes an ordinary working day again; the change is recorded in the audit log.`}
        confirmLabel="Remove"
        danger
        busy={remove.busy}
        error={remove.error}
      />
    </AppShell>
  )
}
