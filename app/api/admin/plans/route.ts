import { NextResponse } from 'next/server'
import { getCurrentAdmin } from '@/lib/admin/auth'
import { listPlans, seedDefaultPlans } from '@/lib/plans'

export async function GET() {
  const admin = await getCurrentAdmin()
  if (!admin) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  await seedDefaultPlans()
  const plans = await listPlans(false)
  return NextResponse.json({ ok: true, plans })
}
