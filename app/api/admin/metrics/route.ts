import { NextResponse } from 'next/server'
import { getCurrentAdmin } from '@/lib/admin/auth'
import { getAdminMetrics } from '@/lib/analytics'

/** B-NBT-10: dashboard payload for /admin/metrics. Server components
 *  call lib/analytics directly; this JSON endpoint exists for the
 *  client-side refresh path and future tooling. */
export async function GET() {
  const admin = await getCurrentAdmin()
  if (!admin) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const metrics = await getAdminMetrics(30)
  if (!metrics) {
    return NextResponse.json({ ok: false, error: 'db_unavailable' }, { status: 503 })
  }
  return NextResponse.json({ ok: true, metrics })
}
