import { NextResponse } from 'next/server'
import { getCurrentAdmin } from '@/lib/admin/auth'
import { listAllFeatures } from '@/lib/features'

/** Admin-only endpoint listing every feature flag with its current
 *  state. The `/admin/features` page reads this on mount and falls
 *  back to optimistic UI for instant toggles. */
export async function GET() {
  const admin = await getCurrentAdmin()
  if (!admin) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  const features = await listAllFeatures()
  return NextResponse.json({ ok: true, features })
}
