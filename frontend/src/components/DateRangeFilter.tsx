import { TextField } from './ui/FormField'

/**
 * From/to date inputs for report screens. Values are YYYY-MM-DD strings owned
 * by the parent, which refetches when they change.
 */
export default function DateRangeFilter({
  idPrefix,
  from,
  to,
  onFromChange,
  onToChange,
}: {
  idPrefix: string
  from: string
  to: string
  onFromChange: (value: string) => void
  onToChange: (value: string) => void
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end gap-3">
      <div className="w-44">
        <TextField
          id={`${idPrefix}-from`}
          label="From"
          type="date"
          value={from}
          max={to}
          onChange={(event) => onFromChange(event.target.value)}
        />
      </div>
      <div className="w-44">
        <TextField
          id={`${idPrefix}-to`}
          label="To"
          type="date"
          value={to}
          min={from}
          onChange={(event) => onToChange(event.target.value)}
        />
      </div>
    </div>
  )
}
