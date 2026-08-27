// M-ROB-2: Next.js instrumentation entry point. We initialise Sentry
// on the server only when SENTRY_DSN is configured. Without the
// `@sentry/nextjs` package installed this file is a no-op.
//
// To enable Sentry:
//   1. `npm install @sentry/nextjs`
//   2. Set SENTRY_DSN in your environment
//   3. The next block will dynamically import @sentry/nextjs and
//      init it with the DSN.

export async function register(): Promise<void> {
  const dsn = process.env.SENTRY_DSN
  if (!dsn) return
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  try {
    // Dynamic import so the bundle stays small when the package is
    // absent. We resolve the module specifier through `new Function`
    // to keep TypeScript from failing the build when @sentry/nextjs
    // is not installed yet (no type declarations available).
    const spec = '@sentry/nextjs'
    type SentryModule = { init?: (opts: { dsn: string; tracesSampleRate: number }) => void }
    const dynImport: (s: string) => Promise<unknown> =
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      (s) => Function('return import(s)')() as never
    const mod = (await dynImport(spec).catch(() => null)) as SentryModule | null
    if (!mod || !mod.init) {
      console.warn('[sentry] SENTRY_DSN set but @sentry/nextjs is not installed')
      return
    }
    mod.init({ dsn, tracesSampleRate: 0.1 })
  } catch (err) {
    console.error('[sentry] init failed', err)
  }
}