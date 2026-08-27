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
  // Migraciones: único hook nativo de Next que corre una vez por
  // instancia de servidor. Deliberadamente SIN await — una Turso lenta no
  // debe retrasar la primera petición. La corrección no depende de que
  // esto termine: los caminos de lectura y escritura de analytics
  // esperan la MISMA promesa memoizada (migrationsReady()), así que si
  // aún no ha acabado simplemente se enganchan a ella.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { migrationsReady } = await import('./lib/migrations')
    void migrationsReady()
      .then(res => {
        if (!res.ok) {
          console.error('[migrations] arranque fallido:', res.error)
        } else if (res.applied.length > 0) {
          // eslint-disable-next-line no-console
          console.log(`[migrations] aplicadas al arrancar: v${res.applied.join(', v')}`)
        }
      })
      .catch(err => console.error('[migrations] arranque fallido:', err))
  }

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
    // Fix (auditoría F3): la forma anterior `Function('return import(s)')()`
    // dejaba `s` sin enlazar → ReferenceError en runtime y Sentry nunca
    // arrancaba. Se pasa `s` como parámetro del cuerpo construido.
    const dynImport = Function('s', 'return import(s)') as (s: string) => Promise<unknown>
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