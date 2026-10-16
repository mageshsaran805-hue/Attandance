export default function LoadingScreen({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex min-h-svh items-center justify-center bg-slate-100 text-slate-500">
      <div className="flex items-center gap-3 text-sm">
        <span
          aria-hidden="true"
          className="inline-block size-4 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-600"
        />
        {label}
      </div>
    </div>
  )
}
