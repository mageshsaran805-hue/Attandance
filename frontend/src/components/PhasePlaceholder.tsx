/**
 * Honest placeholder for a signed-in area whose real screens arrive in a
 * later phase. Keeps navigation and the role shell demonstrable today.
 */
export default function PhasePlaceholder({
  title,
  description,
  items,
}: {
  title: string
  description: string
  items: string[]
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600">{description}</p>

      <ul className="mt-5 space-y-2">
        {items.map((item) => (
          <li key={item} className="flex items-start gap-2 text-sm text-slate-600">
            <span aria-hidden="true" className="mt-1 inline-block size-1.5 shrink-0 rounded-full bg-indigo-500" />
            {item}
          </li>
        ))}
      </ul>

      <p className="mt-6 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
        You are signed in and this area is protected by the backend. The screens above are
        planned for the next phases of development.
      </p>
    </section>
  )
}
