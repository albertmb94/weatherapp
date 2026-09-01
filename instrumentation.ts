// Punto de entrada de instrumentación de Next.
//
// AQUÍ HABÍA UN CABLEADO DE SENTRY Y SE HA QUITADO. Llevaba tiempo
// leyendo `SENTRY_DSN` y haciendo un import dinámico de
// `@sentry/nextjs`... que nunca se instaló. Peor: aunque se hubiera
// instalado, el guard `NEXT_RUNTIME !== 'nodejs'` lo dejaba SÓLO en el
// servidor, y esta aplicación vive en el cliente. `docs/SPRINT_9.md`
// marcaba "[x] Sentry integrado": la casilla estaba puesta y el trabajo
// a medias.
//
// Mantener maquinaria que aparenta funcionar es peor que no tener nada,
// porque quien la lee da por hecho que hay captura de errores. La que sí
// existe ahora es propia y cubre el caso que importaba —el navegador—:
//
//   lib/reportarError.ts      envío desde el cliente
//   app/api/client-errors/    recogida (sin cookies ni identidad)
//   lib/clientErrors.ts       agrupación por huella
//   /api/health               `checks.clientErrors`, últimas 24 h
//
// Si algún día se quiere Sentry de verdad, se instala el paquete y se
// sigue su guía de App Router, que incluye la parte de cliente. No hace
// falta dejar un esqueleto aquí esperando.

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
}
