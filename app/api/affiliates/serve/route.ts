import { NextRequest, NextResponse } from 'next/server'
import { getFeature } from '@/lib/features'
import { listAffiliateProducts } from '@/lib/affiliate'

/**
 * B-NBT-13: public endpoint that serves ONE sponsored product matching
 * a trigger. Called by SponsoredSection when forecast conditions match.
 * No auth needed (public catalog), but rate-limited.
 */
export async function GET(req: NextRequest) {
  const flag = await getFeature('feature.affiliates')
  if (!flag.enabled) {
    return NextResponse.json({ ok: true, product: null })
  }
  const { searchParams } = new URL(req.url)
  const trigger = searchParams.get('trigger') ?? ''
  const locale = searchParams.get('locale') === 'en' ? 'en' : 'es'
  if (!trigger) {
    return NextResponse.json({ ok: false, error: 'missing_trigger' }, { status: 400 })
  }

  const products = await listAffiliateProducts({
    trigger,
    locale,
    enabledOnly: true,
  })
  // Return the first (sort_order ASC is already applied by the query).
  const product = products[0] ?? null
  return NextResponse.json({ ok: true, product })
}
