import { NextRequest, NextResponse } from 'next/server'
import { listAffiliateProducts } from '@/lib/affiliate'
import { rateLimit } from '@/lib/rateLimit'

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
  // Lectura pública que consulta la base en CADA llamada. El slot cambia
  // como mucho unas pocas veces por sesión; 60/min deja holgura de sobra
  // a un visitante real y cierra el grifo a un bucle.
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (!rateLimit(`aff-serve:${ip}`, 60)) {
    return NextResponse.json({ ok: false, error: 'rate_limited' }, { status: 429 })
  }

  const { searchParams } = new URL(req.url)
  const trigger = searchParams.get('trigger') ?? ''
  const locale = searchParams.get('locale') === 'en' ? 'en' : 'es'
  if (!trigger) {
    return NextResponse.json({ ok: false, error: 'missing_trigger' }, { status: 400 })
  }

  let products = await listAffiliateProducts({
    trigger,
    locale,
    enabledOnly: true,
  })
  // El catálogo del admin se crea en español; si no hay producto para el
  // idioma pedido, servimos el que haya para no dejar el slot vacío.
  if (products.length === 0) {
    products = await listAffiliateProducts({ trigger, enabledOnly: true })
  }
  // Return the first (sort_order ASC is already applied by the query).
  const product = products[0] ?? null
  return NextResponse.json({ ok: true, product })
}
