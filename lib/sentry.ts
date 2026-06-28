// M-ROB-2: thin Sentry shim. We do NOT add the @sentry/nextjs
// dependency here because (a) it is ~80 kB gzipped and (b) most local
// dev runs don't have a DSN. Instead we expose a single function that
// forwards to Sentry if the runtime `Sentry` global is available
// (which is the case when @sentry/nextjs has been loaded by
// `instrumentation.ts` based on `SENTRY_DSN`). Until then, all calls
// are no-ops so adding observability never breaks the build.
//
// To enable Sentry:
//   1. `npm install @sentry/nextjs`
//   2. Set SENTRY_DSN in your environment
//   3. The instrumentation hook in `instrumentation.ts` will init
//      Sentry automatically.

type SentryLike = {
  captureException: (err: unknown, ctx?: Record<string, unknown>) => void
}

declare global {
  interface Window {
    Sentry?: SentryLike
  }
  const Sentry: SentryLike | undefined
}

export function captureException(err: unknown, context?: Record<string, unknown>): void {
  if (typeof window !== 'undefined' && window.Sentry) {
    window.Sentry.captureException(err, context)
    return
  }
   
  console.error('[sentry-shim] captureException', err, context)
}