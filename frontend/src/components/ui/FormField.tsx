import { useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react'

const FIELD_CLASSES =
  'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-2 focus:outline-offset-0 focus:outline-indigo-600'

export function TextField({
  label,
  id,
  error,
  hint,
  className = '',
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
        className={`${FIELD_CLASSES} ${error ? 'border-rose-400' : ''} ${className}`}
        {...inputProps}
      />
      {hint && !error && (
        <p id={`${id}-hint`} className="mt-1 text-xs text-slate-500">
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

function EyeIcon({ crossedOut }: { crossedOut: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-5"
    >
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
      {crossedOut && <path d="M4.5 4.5l15 15" />}
    </svg>
  )
}

/**
 * Password input with a show/hide toggle ("eye") button. Same props as
 * TextField; the toggle is keyboard accessible and never submits the form.
 */
export function PasswordField({
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
  const [visible, setVisible] = useState(false)

  return (
    <div className="text-sm">
      <label htmlFor={id} className="font-medium text-slate-700">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
          className={`${FIELD_CLASSES} pr-10 ${error ? 'border-rose-400' : ''}`}
          {...inputProps}
        />
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
          className="absolute bottom-0 right-1 top-1 flex items-center rounded px-2 text-slate-500 transition hover:text-slate-700 focus:outline-2 focus:outline-offset-0 focus:outline-indigo-600"
        >
          <EyeIcon crossedOut={visible} />
        </button>
      </div>
      {hint && !error && (
        <p id={`${id}-hint`} className="mt-1 text-xs text-slate-500">
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
