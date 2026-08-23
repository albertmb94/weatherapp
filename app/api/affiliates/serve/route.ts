import { NextRequest, NextResponse } from 'next/server'
import { listAffiliateProducts } from '@/lib/affiliate'

/**
 * B-NBT-13: public endpoint that serves ONE sponsored product matching
 * a trigger. Called by SponsoredSection when forecast conditions match.
 *
 * B-NBT-14 fix: the `feature.affiliates` gate was REMOVED — it was a
 * redundant second control surface that confused operators ("added
 * product but nothing shows"). The PRODUCTS are the control: if you
 * add an enabled product for a trigger, it serves. Delete or disable
 * it, and it stops. No separate toggle to forget about.
 */
export async function GET(req: NextRequest) {
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
