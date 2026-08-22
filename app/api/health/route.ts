import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getFeature } from '@/lib/features'

/** Lightweight health check used by the admin overview and by
 *  uptime monitors. Probes the DB, the optional Resend/Stripe
 *  configs and Open-Meteo. Always returns 200 unless the DB is
 *  completely down (in which case we 503 so monitors flag it). */
export async function GET() {
  const checks: Record<string, { ok: boolean; detail?: string }> = {}
  try {
    const r = await db.select<{ ok: number }>('SELECT 1 AS ok')
    checks.db = { ok: r.length > 0 }
  } catch (err) {
    checks.db = { ok: false, detail: String(err) }
  }

  const resend = await getFeature('feature.resend')
  checks.resend = { ok: resend.enabled && !!resend.config.api_key, detail: resend.enabled ? 'configured' : 'disabled' }

  const stripe = await getFeature('feature.stripe')
  checks.stripe = { ok: stripe.enabled && !!stripe.config.secret_key, detail: stripe.enabled ? 'configured' : 'disabled' }

  try {
    const r = await fetch('https://api.open-meteo.com/v1/forecast?latitude=41.45&longitude=2.25&hourly=temperature_2m', {
      signal: AbortSignal.timeout(3000),
    })
    checks.openmeteo = { ok: r.ok }
  } catch (err) {
    checks.openmeteo = { ok: false, detail: String(err) }
  }

  const allOk = Object.values(checks).every(c => c.ok)
  return NextResponse.json({ ok: allOk, checks, ts: Date.now() }, { status: allOk ? 200 : 503 })
}
