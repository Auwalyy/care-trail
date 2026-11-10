import { SystemStatus } from '@/features/system/system-status';

export default function HomePage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-12 sm:px-6">
      <header>
        <p className="text-sm font-semibold uppercase tracking-wide text-teal-700">No Patient Left Behind</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-brand-900">CARETRAIL</h1>
        <p className="mt-3 max-w-prose text-ink-muted">
          Community healthcare navigation, referral and follow-up for pregnant women, new mothers and
          newborns. Sign-in and the administration workspace arrive in the next development phase.
        </p>
      </header>
      <SystemStatus />
    </main>
  );
}
