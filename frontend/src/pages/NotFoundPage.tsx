import { Link } from 'react-router'

export default function NotFoundPage() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-slate-50 px-4 text-slate-900">
      <p className="text-sm font-medium text-indigo-600">404</p>
      <h1 className="mt-1 text-xl font-semibold">Page not found</h1>
      <p className="mt-2 max-w-sm text-center text-sm text-slate-500">
        The page you are looking for does not exist or may have moved.
      </p>
      <Link
        to="/"
        className="mt-5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
      >
        Back to start
      </Link>
    </div>
  )
}
