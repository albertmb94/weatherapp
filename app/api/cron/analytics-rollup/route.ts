import { NextRequest, NextResponse } from 'next/server'
import { runAnalyticsRollup } from '@/lib/analytics'

/**
 * B-NBT-10: nightly analytics maintenance.
 *   1. Fold raw page_views into daily_anon_stats with backfill (auditoría
 *      F2/B7): procesa desde el último día rollupeado hasta ayer, para que
 *      un cron fallido no pierda datos al purgar la retención (idempotente).
 *   2. Purge raw page_views/sessions older than the 90-day retention
 *      window so the analytics tables stay bounded.
 *
 * Auth: Vercel Cron sends `Authorization: Bearer $CRON_SECRET` when that
 * env var is configured for the project. Manual triggers must pass the
 * same header.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ ok: false, error: 'cron_not_configured' }, { status: 503 })
  }
  const auth = req.headers.get('authorization') ?? ''
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const result = await runAnalyticsRollup()
  if (!result.ok) {
    // Auditoría: esto ya devolvía 500, pero NUNCA se llegaba a dar —
    // `db.execute` devolvía false en vez de lanzar, así que un rollup en
    // el que fallaban TODAS las sentencias reportaba { ok: true } y a
    // continuación purgaba los datos crudos igualmente. Ahora el rollup
    // usa las variantes estrictas y el purgado está condicionado a que la
    // consolidación se verifique.
    console.error('[cron] rollup de analytics falló:', result.reason)
  }
  return NextResponse.json(result, { status: result.ok ? 200 : 500 })
}
