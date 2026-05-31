export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-950 px-6 text-zinc-50">
      <section className="w-full max-w-xl space-y-4">
        <p className="text-sm uppercase tracking-[0.18em] text-zinc-400">AI Society Lab</p>
        <h1 className="text-3xl font-semibold tracking-tight">Living Agent v0.1</h1>
        <p className="text-zinc-300">
          Backend is installed. Use Telegram Game Master commands to start and run the simulated inhabitant.
        </p>
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 text-sm text-zinc-300">
          <p>Webhook: /api/telegram/webhook</p>
          <p>Cron: /api/cron/tick</p>
        </div>
      </section>
    </main>
  );
}
