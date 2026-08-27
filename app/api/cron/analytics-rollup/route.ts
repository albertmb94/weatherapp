import { NextRequest, NextResponse } from 'next/server'
import { runAnalyticsRollup } from '@/lib/analytics'

/**
 * B-NBT-10: nightly analytics maintenance.
 *   1. Fold yesterday's raw page_views into daily_anon_stats (idempotent).
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
  return NextResponse.json(result, { status: result.ok ? 200 : 500 })
}
