import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { getCurrentAdmin } from '@/lib/admin/auth'
import { getFeature } from '@/lib/features'
import { getPlan, setPlanStripeRefs } from '@/lib/plans'

/**
 * Sync de un plan con Stripe: crea (o reutiliza) el Product y los Prices
 * recurrentes mensual/anual a partir de los precios configurados en
 * /admin/plans, y guarda los IDs generados en la fila del plan.
 *
 * Requiere feature.stripe activa con secret_key. Fallback honesto:
 * si el plan ya tiene price IDs, los verifica contra la cuenta en vez
 * de recrearlos.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentAdmin()
  if (!admin) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  const { id } = await params

  const feature = await getFeature('feature.stripe')
  const config = feature.config as { secret_key?: string } | undefined
  if (!feature.enabled || !config?.secret_key || !config.secret_key.startsWith('sk_')) {
    return NextResponse.json({
      ok: false,
      verified: false,
      reason: 'stripe_not_configured',
      message: 'Activa la feature Stripe y añade la secret key para sincronizar precios.',
    })
  }

  const plan = await getPlan(id)
  if (!plan) {
    return NextResponse.json({ ok: false, verified: false, reason: 'plan_not_found', message: 'Plan no encontrado.' })
  }
  if (!plan.monthlyPriceCents || !plan.yearlyPriceCents || plan.monthlyPriceCents <= 0 || plan.yearlyPriceCents <= 0) {
    return NextResponse.json({
      ok: false,
      verified: false,
      reason: 'prices_missing',
      message: 'Define precios mensual y anual en céntimos antes de sincronizar.',
    })
  }

  const stripe = new Stripe(config.secret_key)
  const name = `${plan.nameEn}`
  try {
    // Reutiliza el producto si ya existe; si no, créalo.
    let productId = plan.stripeProductId
    if (productId) {
      try {
        await stripe.products.retrieve(productId)
      } catch {
        productId = null // fue borrado en Stripe → recrear
      }
    }
    if (!productId) {
      const product = await stripe.products.create({
        name,
        metadata: { plan_id: plan.id },
      })
      productId = product.id
    } else {
      await stripe.products.update(productId, { name })
    }

    const ensurePrice = async (amount: number, interval: 'month' | 'year', existingId: string | null) => {
      if (existingId) {
        try {
          const p = await stripe.prices.retrieve(existingId)
          if (p.product === productId && p.recurring?.interval === interval && p.unit_amount === amount) {
            return existingId
          }
        } catch {
          /* recrear */
        }
      }
      const price = await stripe.prices.create({
        product: productId,
        currency: 'eur',
        unit_amount: amount,
        recurring: { interval },
        metadata: { plan_id: plan.id },
      })
      return price.id
    }

    const priceIdMonthly = await ensurePrice(plan.monthlyPriceCents, 'month', plan.stripePriceIdMonthly)
    const priceIdYearly = await ensurePrice(plan.yearlyPriceCents, 'year', plan.stripePriceIdYearly)

    const saved = await setPlanStripeRefs(plan.id, {
      productId,
      priceIdMonthly,
      priceIdYearly,
    })
    if (!saved) {
      return NextResponse.json({ ok: false, verified: false, reason: 'db_write_failed', message: 'No se pudieron guardar los IDs.' })
    }

    return NextResponse.json({
      ok: true,
      verified: true,
      productId,
      priceIdMonthly,
      priceIdYearly,
      message: 'Plan sincronizado con Stripe: precios creados/verificados.',
    })
  } catch (err) {
    console.error('[plans] sync con Stripe fallido para', plan.id, err)
    return NextResponse.json({
      ok: false,
      verified: false,
      reason: 'stripe_error',
      message: 'Error al sincronizar con Stripe. Revisa la secret key y los precios.',
    })
  }
}
