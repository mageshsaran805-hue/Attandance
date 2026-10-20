import type { ReactNode } from 'react'
import Logo from './Logo'

function Feature({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden="true"
        className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-white/10 text-emerald-300 ring-1 ring-white/15"
      >
        <svg viewBox="0 0 20 20" fill="currentColor" className="size-3.5">
          <path
            fillRule="evenodd"
            d="M16.704 5.296a1 1 0 0 1 0 1.408l-7.25 7.25a1 1 0 0 1-1.408 0l-3.25-3.25a1 1 0 1 1 1.408-1.408l2.546 2.545 6.546-6.545a1 1 0 0 1 1.408 0Z"
            clipRule="evenodd"
          />
        </svg>
      </span>
      <div>
        <p className="text-sm font-medium text-white">{title}</p>
        <p className="mt-0.5 text-sm leading-relaxed text-indigo-100/80">{children}</p>
      </div>
    </li>
  )
}

/**
 * Shared shell for the public sign-in and registration screens: a branded
 * hero panel on desktop and a focused form column on every screen size.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-svh bg-slate-100 text-slate-900 lg:grid lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
      <aside
        aria-label="About College Attendance"
        className="relative hidden overflow-hidden bg-slate-950 px-10 py-12 text-white lg:sticky lg:top-0 lg:flex lg:h-svh lg:flex-col lg:justify-between xl:px-16"
      >
        <div
          aria-hidden="true"
          className="absolute inset-0"
          style={{
            backgroundImage:
              'radial-gradient(circle at 15% 20%, rgba(99,102,241,0.55), transparent 42%), radial-gradient(circle at 88% 8%, rgba(14,165,233,0.32), transparent 38%), radial-gradient(circle at 50% 110%, rgba(79,70,229,0.45), transparent 55%)',
          }}
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 opacity-[0.12]"
          style={{
            backgroundImage:
              'linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)',
            backgroundSize: '44px 44px',
          }}
        />

        <div className="relative">
          <Logo variant="light" />

          <div className="mt-16 max-w-md">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-medium text-indigo-100">
              <span aria-hidden="true" className="size-1.5 rounded-full bg-emerald-400" />
              Morning sessions · Asia/Kolkata
            </span>
            <p className="mt-6 text-4xl font-semibold leading-tight tracking-tight text-white">
              Morning attendance, without the paperwork.
            </p>
            <p className="mt-4 text-base leading-relaxed text-indigo-100/80">
              One OTP-based session per class, a live faculty view, and attendance reports that are
              ready when you are.
            </p>

            <ul className="mt-10 space-y-5">
              <Feature title="Students mark themselves">
                A short-lived 6-digit code replaces the morning roll call.
              </Feature>
              <Feature title="Faculty stay in control">
                Live counts, quick corrections and on-duty marks in one console.
              </Feature>
              <Feature title="Reports you can trust">
                Department and class percentages that count settled sessions only.
              </Feature>
            </ul>
          </div>
        </div>

        <p className="relative text-xs text-indigo-200/80">
          Secure sign-in · Role-based access · College Attendance
        </p>
      </aside>

      <main className="flex min-h-svh flex-col justify-center px-4 py-10 sm:px-6 lg:px-12">
        <div className="mx-auto w-full max-w-md">
          <div className="mb-6 lg:hidden">
            <Logo />
          </div>
          {children}
        </div>
      </main>
    </div>
  )
}
