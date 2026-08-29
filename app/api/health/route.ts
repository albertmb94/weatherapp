import { NextRequest, NextResponse } from 'next/server'
import { db, DbError } from '@/lib/db'
import { migrationStatus } from '@/lib/migrations'
import { getFeature } from '@/lib/features'
import { rateLimit } from '@/lib/rateLimit'
import { todayKey } from '@/lib/analytics/time'

/**
 * Estado del cron nocturno de analítica.
 *
 * POR QUÉ ESTÁ AQUÍ: `CRON_SECRET` no llegó a definirse en producción y
 * /api/cron/analytics-rollup respondía 503 `cron_not_configured` a TODAS
 * las llamadas — incluida la que hace Vercel cada noche, porque Vercel
 * solo envía la cabecera `Authorization: Bearer` cuando esa variable
 * existe. El cron estuvo caído CUATRO DÍAS y el único aviso apareció en
 * /admin/metrics ("N día(s) sin consolidar"), es decir, en una pantalla
 * distinta y solo después de que ya hubiera datos sin consolidar.
 *
 * Un despliegue mal configurado tiene que verse el primer día, en la
 * pantalla a la que se acude cuando algo va mal.
 */
async function checkCron(): Promise<{ ok: boolean; detail?: string }> {
  if (!process.env.CRON_SECRET) {
    // Sin secreto el cron NUNCA puede ejecutarse: no es que vaya con
    // retraso, es que está apagado.
    return { ok: false, detail: 'CRON_SECRET sin definir: el rollup nunca se ejecuta' }
  }
  try {
    const hoy = todayKey()
    // EL ATRASO SON DÍAS CON DATOS SIN CONSOLIDAR, no la distancia hasta
    // ayer. La primera versión comparaba MAX(date) con ayer sin más, y
    // eso daba FALSA ALARMA en cuanto había un día sin visitas: no había
    // nada que consolidar, el cron hacía lo correcto, y el panel lo
    // pintaba en rojo. Una alarma que salta cuando no pasa nada enseña a
    // ignorar el rojo, que es justo lo que esta comprobación vino a
    // evitar.
    const pendientes = await db.selectOrThrow<{ n: number; primero: string | null }>(
      `SELECT COUNT(DISTINCT day) AS n, MIN(day) AS primero
       FROM page_views
       WHERE day < ? AND day NOT IN (SELECT DISTINCT date FROM daily_anon_stats)`,
      [hoy],
    )
    const sinConsolidar = Number(pendientes[0]?.n ?? 0)

    const ultimas = await db.selectOrThrow<{ d: string | null }>(
      'SELECT MAX(date) AS d FROM daily_anon_stats',
    )
    const ultimo = ultimas[0]?.d ? String(ultimas[0].d) : null

    if (sinConsolidar > 0) {
      return {
        ok: false,
        detail:
          `${sinConsolidar} día(s) con datos sin consolidar desde ${String(pendientes[0]?.primero)}` +
          (ultimo ? ` · último consolidado: ${ultimo}` : ' · nunca se ha consolidado'),
      }
    }
    return {
      ok: true,
      detail: ultimo ? `al día (último: ${ultimo})` : 'al día (nada que consolidar)',
    }
  } catch {
    return { ok: false, detail: 'no se pudo leer el estado del rollup' }
  }
}

// Cache en memoria del probe a Open-Meteo (60 s): el poll del admin cada
// 30 s no debe golpear el upstream en cada llamada (quemaría la cuota).
let openMeteoCache: { at: number; ok: boolean } | null = null

async function checkOpenMeteo(): Promise<{ ok: boolean }> {
  const now = Date.now()
  if (openMeteoCache && now - openMeteoCache.at < 60_000) {
    return { ok: openMeteoCache.ok }
  }
  let ok = false
  try {
    const r = await fetch('https://api.open-meteo.com/v1/forecast?latitude=41.45&longitude=2.25&hourly=temperature_2m', {
      signal: AbortSignal.timeout(3000),
    })
    ok = r.ok
  } catch {
    ok = false
  }
  openMeteoCache = { at: now, ok }
  return { ok }
}

/** Lightweight health check for the admin overview and uptime monitors.
 *  Hardened (auditoría F3): sin leaks de errores crudos (`String(err)`),
 *  sin desvelar detalles de configuración de terceros, y con el probe de
 *  Open-Meteo cacheado en memoria. Solo devuelve 503 si la DB está caída
 *  (los servicios externos opcionales no tumban el health). */
export async function GET(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (!rateLimit(`health:${ip}`, 20)) {
    return NextResponse.json({ ok: false, error: 'rate_limited' }, { status: 429 })
  }

  const checks: Record<string, { ok: boolean; detail?: string }> = {}
  // `db.select` no lanza nunca: devolvía [] tanto si la BD estaba caída
  // como si no había ninguna configurada, y ambos casos se colapsaban en
  // el mismo "ok:false" sin decir cuál era. Con la variante estricta el
  // health distingue un despliegue mal configurado (falta la env) de una
  // base de datos que existe pero no responde.
  try {
    const r = await db.selectOrThrow<{ ok: number }>('SELECT 1 AS ok')
    checks.db = { ok: r.length > 0 }
  } catch (err) {
    const kind = err instanceof DbError ? err.kind : 'unknown'
    console.error('[health] db check failed:', err instanceof Error ? err.message : err)
    checks.db = { ok: false, detail: kind === 'not_configured' ? 'not_configured' : 'down' }
  }

  // Esquema: un despliegue con migraciones pendientes responde a las
  // consultas pero le faltan tablas o columnas, y eso se manifestaba
  // como "cero visitas" en vez de como un error.
  if (checks.db.ok) {
    const schema = await migrationStatus()
    checks.schema = schema.ok
      ? {
          ok: schema.pending.length === 0 && schema.drift.length === 0,
          detail: `v${schema.currentVersion}/v${schema.latestVersion}` +
            (schema.pending.length > 0 ? ` · ${schema.pending.length} pendiente(s)` : '') +
            (schema.drift.length > 0 ? ` · deriva en v${schema.drift.map(d => d.version).join(',')}` : ''),
        }
      : { ok: false, detail: 'unreadable' }
  }

  // No desvelar si Resend/Stripe están configurados: solo "ok/disabled".
  const resend = await getFeature('feature.resend')
  checks.resend = { ok: false, detail: 'disabled' }
  if (resend.enabled) checks.resend = { ok: false, detail: 'configured' }

  const stripe = await getFeature('feature.stripe')
  checks.stripe = { ok: false, detail: 'disabled' }
  if (stripe.enabled) checks.stripe = { ok: false, detail: 'configured' }

  if (checks.db.ok) checks.cron = await checkCron()

  checks.openmeteo = await checkOpenMeteo()

  // Resend/Stripe son opcionales: solo la DB y Open-Meteo (core) cuentan
  // para el estado global; los flags de pago/email no deben marcar DOWN.
  const allOk = checks.db.ok && checks.openmeteo.ok
  return NextResponse.json({ ok: allOk, checks, ts: Date.now() }, { status: allOk ? 200 : 503 })
}
