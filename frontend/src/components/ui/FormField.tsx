import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'

const FIELD_CLASSES =
  'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-2 focus:outline-offset-0 focus:outline-indigo-600'

export function TextField({
  label,
  id,
  error,
  hint,
  ...inputProps
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string
  id: string
  error?: string
  hint?: string
}) {
  return (
    <div className="text-sm">
      <label htmlFor={id} className="font-medium text-slate-700">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        className={`${FIELD_CLASSES} ${error ? 'border-rose-400' : ''}`}
        {...inputProps}
      />
      {hint && !error && (
        <p id={`${id}-hint`} className="mt-1 text-xs text-slate-400">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="mt-1 text-xs text-rose-600">
          {error}
        </p>
      )}
    </div>
  )
}

export function SelectField({
  label,
  id,
  error,
  children,
  ...selectProps
}: SelectHTMLAttributes<HTMLSelectElement> & {
  label: string
  id: string
  error?: string
  children: ReactNode
}) {
  return (
    <div className="text-sm">
      <label htmlFor={id} className="font-medium text-slate-700">
        {label}
      </label>
      <select
        id={id}
        aria-invalid={error ? true : undefined}
        className={`${FIELD_CLASSES} ${error ? 'border-rose-400' : ''}`}
        {...selectProps}
      >
        {children}
      </select>
      {error && (
        <p className="mt-1 text-xs text-rose-600">{error}</p>
      )}
    </div>
  )
}
