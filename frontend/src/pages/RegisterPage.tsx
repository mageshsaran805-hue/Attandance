import { useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router'
import AuthLayout from '../components/AuthLayout'
import HealthIndicator from '../components/HealthIndicator'
import LoadingScreen from '../components/LoadingScreen'
import Alert from '../components/ui/Alert'
import Button from '../components/ui/Button'
import { PasswordField, SelectField, TextField } from '../components/ui/FormField'
import { apiFetch } from '../lib/api'
import type { RegistrationChoicesResponse, SubmittedRegistration } from '../lib/api-types'
import { useAuth } from '../lib/auth-context'
import { useAction } from '../lib/forms'
import { HOME_PATH_BY_ROLE } from '../lib/roles'
import { useFetch } from '../lib/use-fetch'

/**
 * Public student self-registration (no session required). A submission is a
 * request for the admin review queue: no account exists until an
 * administrator approves it, and approval also enrolls the student in the
 * class they picked here.
 */
export default function RegisterPage() {
  const { user, status: authStatus } = useAuth()
  const choices = useFetch<RegistrationChoicesResponse>('/api/registration/classes')
  const action = useAction()

  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [registerNumber, setRegisterNumber] = useState('')
  const [phone, setPhone] = useState('')
  const [section, setSection] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [classId, setClassId] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [submitted, setSubmitted] = useState<{ classLabel: string } | null>(null)

  if (authStatus === 'loading') {
    return <LoadingScreen label="Checking your session…" />
  }
  if (user) {
    return <Navigate to={HOME_PATH_BY_ROLE[user.role]} replace />
  }

  const departments = (choices.data?.departments ?? []).filter(
    (department) => department.classes.length > 0,
  )
  const selectedDepartment = departments.find((department) => department.id === departmentId)
  const passwordsMatch = password === confirmPassword
  const ready =
    fullName.trim() !== '' &&
    email.trim() !== '' &&
    registerNumber.trim() !== '' &&
    classId !== '' &&
    password !== '' &&
    confirmPassword !== ''

  const handleDepartmentChange = (value: string) => {
    setDepartmentId(value)
    const department = departments.find((entry) => entry.id === value)
    // A department with a single class needs no second choice.
    const onlyClass = department?.classes.length === 1 ? department.classes[0] : undefined
    setClassId(onlyClass?.id ?? '')
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!passwordsMatch) {
      return
    }
    const chosenClass = selectedDepartment?.classes.find((entry) => entry.id === classId)
    await action.run(async () => {
      await apiFetch<{ registration: SubmittedRegistration }>('/api/registration', {
        method: 'POST',
        body: {
          fullName: fullName.trim(),
          email: email.trim(),
          registerNumber: registerNumber.trim(),
          ...(phone.trim() === '' ? {} : { phone: phone.trim() }),
          ...(section.trim() === '' ? {} : { section: section.trim() }),
          classId,
          password,
        },
      })
      setSubmitted({
        classLabel: chosenClass
          ? `${selectedDepartment?.name ?? ''} — ${chosenClass.name} (${chosenClass.academicYear})`
          : '',
      })
    })
  }

  return (
    <AuthLayout>
      {submitted ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xl shadow-slate-200/60 sm:p-8">
          <span
            aria-hidden="true"
            className="grid size-12 place-items-center rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-emerald-200"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="size-6">
              <path
                fillRule="evenodd"
                d="M16.704 5.296a1 1 0 0 1 0 1.408l-7.25 7.25a1 1 0 0 1-1.408 0l-3.25-3.25a1 1 0 1 1 1.408-1.408l2.546 2.545 6.546-6.545a1 1 0 0 1 1.408 0Z"
                clipRule="evenodd"
              />
            </svg>
          </span>
          <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-emerald-600">
            Request received
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">
            Registration submitted
          </h1>
          <p className="mt-1 text-sm text-slate-500">Your request is waiting for review.</p>

          <div className="mt-5 space-y-3 text-sm leading-relaxed text-slate-600">
            {submitted.classLabel && (
              <p>
                Requested class:{' '}
                <span className="font-medium text-slate-900">{submitted.classLabel}</span>
              </p>
            )}
            <p>
              An administrator will approve or reject your request. Once approved, sign in with{' '}
              <span className="font-medium text-slate-900">{email.trim()}</span> and the password
              you chose.
            </p>
          </div>

          <Link
            to="/login"
            className="mt-6 block w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-center text-sm font-medium text-white shadow-sm transition hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
          >
            Back to sign in
          </Link>
        </section>
      ) : (
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xl shadow-slate-200/60 sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600">
            New student
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">
            Student registration
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Create a request — an administrator approves it before you can sign in.
          </p>

            {choices.loading && (
              <p className="mt-5 text-sm text-slate-500">Loading departments and classes…</p>
            )}

            {choices.error && (
              <Alert className="mt-5">
                <p>{choices.error}</p>
                <button
                  type="button"
                  onClick={choices.reload}
                  className="mt-2 font-medium underline underline-offset-2"
                >
                  Try again
                </button>
              </Alert>
            )}

            {!choices.loading && !choices.error && departments.length === 0 && (
              <div className="mt-5 space-y-4">
                <Alert tone="info">
                  Registration isn&apos;t open yet: no classes have been set up. Please contact
                  your college administrator.
                </Alert>
                <Link
                  to="/login"
                  className="block w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-center text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                >
                  Back to sign in
                </Link>
              </div>
            )}

            {!choices.loading && !choices.error && departments.length > 0 && (
              <form
                onSubmit={(event) => void handleSubmit(event)}
                className="mt-5 space-y-4"
                noValidate
              >
                <TextField
                  label="Full name"
                  id="register-full-name"
                  autoComplete="name"
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  error={action.issues.fullName}
                />

                <TextField
                  label="Email"
                  id="register-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  error={action.issues.email}
                />

                <TextField
                  label="Register number"
                  id="register-number"
                  value={registerNumber}
                  onChange={(event) => setRegisterNumber(event.target.value)}
                  hint="Your roll number as printed on the attendance sheet."
                  error={action.issues.registerNumber}
                />

                <TextField
                  label="Phone number (optional)"
                  id="register-phone"
                  type="tel"
                  autoComplete="tel"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  error={action.issues.phone}
                />

                <SelectField
                  label="Department"
                  id="register-department"
                  value={departmentId}
                  onChange={(event) => handleDepartmentChange(event.target.value)}
                >
                  <option value="">Select a department…</option>
                  {departments.map((department) => (
                    <option key={department.id} value={department.id}>
                      {department.name} ({department.code})
                    </option>
                  ))}
                </SelectField>

                <SelectField
                  label="Class (year and section)"
                  id="register-class"
                  value={classId}
                  onChange={(event) => setClassId(event.target.value)}
                  error={action.issues.classId}
                  disabled={departmentId === ''}
                >
                  <option value="">
                    {departmentId === '' ? 'Choose a department first…' : 'Select your class…'}
                  </option>
                  {(selectedDepartment?.classes ?? []).map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name} ({entry.academicYear})
                    </option>
                  ))}
                </SelectField>

                <TextField
                  label="Section (optional)"
                  id="register-section"
                  value={section}
                  onChange={(event) => setSection(event.target.value)}
                  hint="e.g. A, B or A1 — leave blank if you are not sure yet."
                  error={action.issues.section}
                />

                <PasswordField
                  label="Password"
                  id="register-password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  hint="At least 8 characters with a letter and a number."
                  error={action.issues.password}
                />

                <PasswordField
                  label="Confirm password"
                  id="register-confirm"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  error={
                    confirmPassword !== '' && !passwordsMatch
                      ? 'Passwords do not match.'
                      : undefined
                  }
                />

                {action.error && <Alert>{action.error}</Alert>}

                <Button
                  type="submit"
                  variant="primary"
                  className="w-full"
                  loading={action.busy}
                  disabled={!ready || !passwordsMatch}
                >
                  {action.busy ? 'Submitting…' : 'Submit registration request'}
                </Button>
              </form>
            )}
          </section>
        )}

      {!submitted && (
        <p className="mt-5 text-center text-sm text-slate-500">
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-indigo-600 hover:text-indigo-700">
            Sign in
          </Link>
        </p>
      )}

      {import.meta.env.DEV && (
        <div className="mt-6">
          <HealthIndicator />
        </div>
      )}
    </AuthLayout>
  )
}
