import type { ReportSessionEntry } from '../lib/api-types'
import { formatDate, formatPercent, formatShortDate } from '../lib/format'

interface TrendPoint {
  id: string
  sessionDate: string
  percentage: number
  present: number
  onDuty: number
  absent: number
  total: number
}

function buildPoints(sessions: ReportSessionEntry[]): TrendPoint[] {
  const points: TrendPoint[] = []
  for (const session of sessions) {
    if (session.status !== 'closed') {
      continue
    }
    const total = session.present + session.onDuty + session.absent
    if (total === 0) {
      continue
    }
    points.push({
      id: session.id,
      sessionDate: session.sessionDate,
      percentage: ((session.present + session.onDuty) / total) * 100,
      present: session.present,
      onDuty: session.onDuty,
      absent: session.absent,
      total,
    })
  }
  points.sort((a, b) => a.sessionDate.localeCompare(b.sessionDate))
  return points
}

/**
 * Dependency-free SVG trend line for a class report. Only closed sessions
 * with settled marks are shown; open sessions appear in the table instead.
 */
export default function SessionTrendChart({ sessions }: { sessions: ReportSessionEntry[] }) {
  const points = buildPoints(sessions)
  const height = 190
  const top = 12
  const bottom = 34
  const left = 38
  const right = 12
  const width = Math.max(520, points.length * 42 + left + right)
  const plotWidth = width - left - right
  const plotHeight = height - top - bottom
  const baseline = top + plotHeight

  const xFor = (index: number) =>
    left + (points.length === 1 ? plotWidth / 2 : (index / (points.length - 1)) * plotWidth)
  const yFor = (percentage: number) => top + (1 - percentage / 100) * plotHeight
  const linePath = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${xFor(index)} ${yFor(point.percentage)}`)
    .join(' ')
  const areaPath =
    points.length > 1
      ? `${linePath} L ${xFor(points.length - 1)} ${baseline} L ${xFor(0)} ${baseline} Z`
      : ''
  const labelStep = Math.max(1, Math.ceil(points.length / 8))

  return (
    <section className="mt-8 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Attendance trend
          </h3>
          <p className="mt-1 text-sm text-slate-500">
            Closed sessions only · present + on duty ÷ settled marks
          </p>
        </div>
        <span className="text-xs text-slate-500">
          {points.length} settled session{points.length === 1 ? '' : 's'}
        </span>
      </div>

      {points.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
          No closed sessions with attendance marks in this range yet.
        </p>
      ) : (
        <div
          role="region"
          aria-label="Attendance trend chart"
          tabIndex={0}
          className="mt-4 overflow-x-auto rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
        >
          <svg
            role="img"
            aria-label="Attendance percentage per closed session"
            width={width}
            height={height}
            className="block max-w-none"
          >
            <defs>
              <linearGradient id="attendance-area" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#6366f1" stopOpacity="0.35" />
                <stop offset="100%" stopColor="#6366f1" stopOpacity="0" />
              </linearGradient>
            </defs>

            {[0, 25, 50, 75, 100].map((value) => (
              <g key={value}>
                <line
                  x1={left}
                  x2={width - right}
                  y1={yFor(value)}
                  y2={yFor(value)}
                  stroke={value === 75 ? '#a7f3d0' : '#e2e8f0'}
                  strokeDasharray={value === 75 ? '4 4' : undefined}
                  strokeWidth="1"
                />
                <text
                  x={left - 6}
                  y={yFor(value) + 3.5}
                  textAnchor="end"
                  fontSize="10"
                  fill="#64748b"
                >
                  {value}%
                </text>
              </g>
            ))}

            {areaPath && <path d={areaPath} fill="url(#attendance-area)" />}
            <path
              d={linePath}
              fill="none"
              stroke="#4f46e5"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {points.map((point, index) => (
              <g key={point.id}>
                <circle
                  cx={xFor(index)}
                  cy={yFor(point.percentage)}
                  r="3.5"
                  fill="#4f46e5"
                  stroke="#ffffff"
                  strokeWidth="1.5"
                >
                  <title>
                    {formatDate(point.sessionDate)}: {formatPercent(point.percentage)} present/on
                    duty of {point.total}
                  </title>
                </circle>
                {(index % labelStep === 0 || index === points.length - 1) && (
                  <text
                    x={xFor(index)}
                    y={height - 10}
                    textAnchor="middle"
                    fontSize="10"
                    fill="#64748b"
                  >
                    {formatShortDate(point.sessionDate)}
                  </text>
                )}
              </g>
            ))}
          </svg>
        </div>
      )}
    </section>
  )
}
