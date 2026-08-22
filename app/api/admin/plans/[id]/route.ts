import { NextRequest, NextResponse } from 'next/server'
import { getCurrentAdmin } from '@/lib/admin/auth'
import { getPlan, upsertPlan } from '@/lib/plans'
import { safeDecode } from '@/lib/api/params'

interface PlanPayload {
  kind?: 'premium' | 'stations' | 'bundle'
  nameEs?: string
  nameEn?: string
  descriptionEs?: string | null
  descriptionEn?: string | null
  monthlyPriceCents?: number | null
  yearlyPriceCents?: number | null
  stripePriceIdMonthly?: string | null
  stripePriceIdYearly?: string | null
  features?: string[]
  enabled?: boolean
  sortOrder?: number
  badgeEs?: string | null
  badgeEn?: string | null
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentAdmin()
  if (!admin) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  const { id } = await params
  const decodedGet = safeDecode(id)
  if (decodedGet === null) {
    return NextResponse.json({ ok: false, error: 'malformed_id' }, { status: 400 })
  }
  const plan = await getPlan(decodedGet)
  if (!plan) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })
  return NextResponse.json({ ok: true, plan })
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentAdmin()
  if (!admin) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  const { id } = await params
  const planId = safeDecode(id)
  if (planId === null) {
    return NextResponse.json({ ok: false, error: 'malformed_id' }, { status: 400 })
  }
  let body: PlanPayload
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 })
  }
  const existing = await getPlan(planId)
  const ok = await upsertPlan({
    id: planId,
    kind: body.kind ?? existing?.kind ?? 'premium',
    nameEs: body.nameEs ?? existing?.nameEs ?? planId,
    nameEn: body.nameEn ?? existing?.nameEn ?? planId,
    descriptionEs: body.descriptionEs ?? existing?.descriptionEs ?? null,
    descriptionEn: body.descriptionEn ?? existing?.descriptionEn ?? null,
    monthlyPriceCents: body.monthlyPriceCents ?? existing?.monthlyPriceCents ?? null,
    yearlyPriceCents: body.yearlyPriceCents ?? existing?.yearlyPriceCents ?? null,
    stripePriceIdMonthly: body.stripePriceIdMonthly ?? existing?.stripePriceIdMonthly ?? null,
    stripePriceIdYearly: body.stripePriceIdYearly ?? existing?.stripePriceIdYearly ?? null,
    features: body.features ?? existing?.features ?? [],
    enabled: body.enabled ?? existing?.enabled ?? true,
    sortOrder: body.sortOrder ?? existing?.sortOrder ?? 0,
    badgeEs: body.badgeEs ?? existing?.badgeEs ?? null,
    badgeEn: body.badgeEn ?? existing?.badgeEn ?? null,
  })
  if (!ok) return NextResponse.json({ ok: false, error: 'save_failed' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
