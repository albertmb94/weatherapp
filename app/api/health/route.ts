import { NextRequest, NextResponse } from 'next/server'
import { rateLimit } from '@/lib/rateLimit'
import { comprobarSalud } from '@/lib/health'

/**
 * Autodiagnóstico del despliegue.
 *
 * Las comprobaciones viven en `lib/health.ts` para que el cron de
 * vigilancia (`/api/cron/health-check`) pueda ejecutarlas sin pedirse a
 * sí mismo por HTTP.
 */
export async function GET(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (!rateLimit(`health:${ip}`, 20)) {
    return NextResponse.json({ ok: false, error: 'rate_limited' }, { status: 429 })
  }

  const { ok, checks } = await comprobarSalud()
  return NextResponse.json({ ok, checks, ts: Date.now() }, { status: ok ? 200 : 503 })
}
