import { useState } from 'react'
import type { NonWorkingDaysResponse, StudentHistoryResponse } from '../lib/api-types'
import { formatDate, todayIso } from '../lib/format'
import { useFetch } from '../lib/use-fetch'
import Alert from './ui/Alert'
import Button from './ui/Button'

/**
 * The student's own month view: one cell per day, coloured by what happened
 * across their classes that day (green = attended, sky = all on duty, red =
 * missed a session, amber = mixed, indigo tint = session still open and
 * unmarked). Non-working days from the college calendar are greyed out.
 * Counts read attended / sessions-for-that-day, so a student in two classes
 * sees "2/2" on a fully attended day.
 */

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

type DayTone = 'present' | 'onDuty' | 'mixed' | 'absent' | 'pending' | 'holiday' | 'empty' | 'future'

interface DayCell {
  iso: string
  dayNumber: number
  tone: DayTone
  /** e.g. "2/2": attended sessions over sessions that day. */
  count: string
  title: string
}

const TONE_CLASSES: Record<DayTone, string> = {
  present: 'bg-emerald-100 text-emerald-800',
  onDuty: 'bg-sky-100 text-sky-800',
  mixed: 'bg-amber-100 text-amber-800',
  absent: 'bg-rose-100 text-rose-800',
  pending: 'bg-indigo-100 text-indigo-800',
  holiday: 'bg-slate-200 text-slate-600',
  empty: 'bg-white text-slate-500 ring-1 ring-inset ring-slate-200',
  future: 'bg-white text-slate-500 ring-1 ring-inset ring-slate-200',
}

const LEGEND: Array<{ tone: DayTone; label: string }> = [
  { tone: 'present', label: 'Attended' },
  { tone: 'onDuty', label: 'On duty' },
  { tone: 'absent', label: 'Missed' },
  { tone: 'mixed', label: 'Partly missed' },
  { tone: 'pending', label: 'Session open' },
  { tone: 'holiday', label: 'Holiday' },
]

function monthLabel(monthIso: string): string {
  const [year = 0, month = 1] = monthIso.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-IN', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

function shiftMonth(monthIso: string, delta: number): string {
  const [year = 0, month = 1] = monthIso.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1 + delta, 1)).toISOString().slice(0, 7)
}

function statusLabel(status: string | null, sessionStatus: string): string {
  if (status === 'present') return 'Present'
  if (status === 'on_duty') return 'On duty'
  if (status === 'absent') return 'Absent'
  return sessionStatus === 'open' ? 'Pending' : 'No record'
}

export default function AttendanceCalendar() {
  const [month, setMonth] = useState(() => todayIso().slice(0, 7))
  const today = todayIso()

  const [year = 0, monthNumber = 1] = month.split('-').map(Number)
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()
  const from = `${month}-01`
  const to = `${month}-${String(daysInMonth).padStart(2, '0')}`

  const history = useFetch<StudentHistoryResponse>(
    `/api/student/attendance/history?from=${from}&to=${to}`,
  )
  const calendar = useFetch<NonWorkingDaysResponse>(
    `/api/calendar/non-working-days?from=${from}&to=${to}`,
  )

  const entries = history.data?.sessions ?? []
  const holidays = new Map(
    (calendar.data?.nonWorkingDays ?? []).map((entry) => [entry.day, entry.label]),
  )

  const firstWeekday = (new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay() + 6) % 7
  const cells: DayCell[] = []
  for (let day = 1; day <= daysInMonth; day += 1) {
    const iso = `${month}-${String(day).padStart(2, '0')}`
    const dayEntries = entries.filter((entry) => entry.sessionDate === iso)
    const holiday = holidays.get(iso)

    if (dayEntries.length === 0) {
      if (holiday) {
        cells.push({
          iso,
          dayNumber: day,
          tone: 'holiday',
          count: '',
          title: `Holiday — ${holiday}`,
        })
      } else if (iso > today) {
        cells.push({ iso, dayNumber: day, tone: 'future', count: '', title: 'Later this month' })
      } else {
        cells.push({ iso, dayNumber: day, tone: 'empty', count: '', title: 'No session' })
      }
      continue
    }

    const attended = dayEntries.filter(
      (entry) => entry.status === 'present' || entry.status === 'on_duty',
    ).length
    const onlyDuty =
      dayEntries.length > 0 && dayEntries.every((entry) => entry.status === 'on_duty')
    const absent = dayEntries.filter((entry) => entry.status === 'absent').length
    const pending = dayEntries.filter(
      (entry) => entry.sessionStatus === 'open' && entry.status === null,
    ).length

    let tone: DayTone
    if (attended > 0 && absent > 0) {
      tone = 'mixed'
    } else if (absent > 0) {
      tone = 'absent'
    } else if (pending > 0) {
      tone = 'pending'
    } else if (onlyDuty) {
      tone = 'onDuty'
    } else {
      tone = 'present'
    }

    const details = dayEntries
      .map((entry) => `${entry.className}: ${statusLabel(entry.status, entry.sessionStatus)}`)
      .join(' · ')

    cells.push({
      iso,
      dayNumber: day,
      tone,
      count: `${attended}/${dayEntries.length}`,
      title: holiday ? `${details} · marked non-working (${holiday})` : details,
    })
  }

  const paddedCells: Array<DayCell | null> = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...cells,
  ]
  const weeks: Array<Array<DayCell | null>> = []
  for (let index = 0; index < paddedCells.length; index += 7) {
    weeks.push(paddedCells.slice(index, index + 7))
  }

  return (
    <section className="mt-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Attendance calendar
          </h3>
          <p className="mt-1 text-sm text-slate-500">
            Counts show attended sessions over sessions held that day.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            aria-label="Previous month"
            onClick={() => setMonth((current) => shiftMonth(current, -1))}
          >
            ←
          </Button>
          <span
            aria-live="polite"
            className="min-w-32 text-center text-sm font-medium text-slate-700"
          >
            {monthLabel(month)}
          </span>
          <Button
            variant="ghost"
            aria-label="Next month"
            onClick={() => setMonth((current) => shiftMonth(current, 1))}
          >
            →
          </Button>
        </div>
      </div>

      {history.error && <Alert className="mt-4">{history.error}</Alert>}
      {history.loading && <p className="mt-4 text-sm text-slate-500">Loading calendar…</p>}

      {history.data && (
        <>
          <div
            role="grid"
            aria-label={`Attendance calendar for ${monthLabel(month)}`}
            className="mt-4 grid grid-cols-7 gap-1"
          >
            <div role="row" className="contents">
              {WEEKDAYS.map((weekday) => (
                <div
                  key={weekday}
                  role="columnheader"
                  className="py-1 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-500"
                >
                  {weekday}
                </div>
              ))}
            </div>
            {weeks.map((week, weekIndex) => (
              <div key={`week-${weekIndex}`} role="row" className="contents">
                {week.map((cell, dayIndex) =>
                  cell ? (
                    <div
                      key={cell.iso}
                      role="gridcell"
                      title={cell.title}
                      aria-label={`${formatDate(cell.iso)}: ${cell.title}${
                        cell.count !== '' ? ` (${cell.count} attended)` : ''
                      }`}
                      className={`flex h-14 flex-col rounded-lg p-1.5 ${TONE_CLASSES[cell.tone]}`}
                    >
                      <span className="text-xs font-semibold leading-none">{cell.dayNumber}</span>
                      {cell.count !== '' && (
                        <span className="mt-auto text-[11px] font-medium leading-none">
                          {cell.count}
                        </span>
                      )}
                    </div>
                  ) : (
                    <div
                      key={`blank-${weekIndex}-${dayIndex}`}
                      role="gridcell"
                      aria-hidden="true"
                    />
                  ),
                )}
              </div>
            ))}
          </div>

          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
            {LEGEND.map((item) => (
              <span key={item.tone} className="flex items-center gap-1.5 text-xs text-slate-500">
                <span className={`inline-block h-3 w-3 rounded-sm ${TONE_CLASSES[item.tone]}`} />
                {item.label}
              </span>
            ))}
          </div>
        </>
      )}
    </section>
  )
}
