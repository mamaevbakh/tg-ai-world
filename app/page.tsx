import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen bg-stone-50 text-zinc-950">
      <section className="border-b border-zinc-200 bg-white">
        <div className="mx-auto max-w-5xl px-6 py-10">
          <p className="text-sm uppercase tracking-wide text-zinc-500">Telegram experiment</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight">
            72-hour Social-Cognitive Identity Detection
          </h1>
          <p className="mt-4 max-w-3xl text-lg leading-8 text-zinc-700">
            Two neutral AI agents communicate publicly through separate Telegram bots, answer observer
            questions immediately, keep private analyses, and produce final behavioral reports after 72 hours.
          </p>
          <div className="mt-6 flex gap-3">
            <Link className="button" href="/admin">
              Open admin
            </Link>
            <a className="button-secondary" href="/api/health">
              Health
            </a>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-5xl gap-4 px-6 py-8 md:grid-cols-3">
        {[
          ["Main protocol", "Every hour Adam initiates and Galya responds."],
          ["Observer layer", "Telegram users can send /a, /b, or /both and receive immediate answers."],
          ["Memory rules", "All public events enter the shared transcript; private analyses stay isolated."]
        ].map(([title, body]) => (
          <article key={title} className="rounded border border-zinc-200 bg-white p-4">
            <h2 className="font-semibold">{title}</h2>
            <p className="mt-2 text-sm leading-6 text-zinc-600">{body}</p>
          </article>
        ))}
      </section>
    </main>
  );
}
