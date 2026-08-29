/**
 * Premium subscription checkout (B-NBT-10, Fase 5).
 *
 * Gated by `feature.stripe` + `feature.premium_checkout`. The Stripe
 * secret key comes from `feature_flags.config` (admin-editable), so no
 * redeploy is needed to rotate keys. Prices are built INLINE from the
 * `plans` table (name + cents + interval) so the admin never has to
 * create Stripe Price objects manually — Checkout accepts price_data.
 */

import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { getFeature } from '@/lib/features'
import { listPlans } from '@/lib/plans'
import { appOrigin } from '@/lib/appUrl'
import { rateLimit } from '@/lib/rateLimit'

interface CheckoutPayload {
  email?: string
  plan?: 'monthly' | 'yearly'
}

export async function POST(req: NextRequest) {
  // CADA petición aquí crea una sesión en Stripe: sin tope, cualquiera
  // puede generarlas en bucle. No es sólo ruido en el panel de Stripe —
  // consume la cuota de la API de la cuenta, y el día que se agote deja
  // de poder cobrar quien sí quería pagar. Una persona real pulsa
  // "suscribirse" una vez, no diez por minuto.
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (!rateLimit(`checkout:${ip}`, 10)) {
    return NextResponse.json({ ok: false, error: 'rate_limited' }, { status: 429 })
  }

  const stripeFlag = await getFeature('feature.stripe')
  const checkout = await getFeature('feature.premium_checkout')
  if (!stripeFlag.enabled || !checkout.enabled) {
    return NextResponse.json(
      {
        ok: false,
        error: 'premium_checkout_disabled',
        message:
          'El checkout de Premium está desactivado. El administrador debe activar feature.stripe y feature.premium_checkout en /admin/features.',
      },
      { status: 503 },
    )
  }
  const secretKey = String(stripeFlag.config.secret_key ?? '')
  if (!secretKey.startsWith('sk_')) {
    return NextResponse.json(
      { ok: false, error: 'stripe_not_configured', message: 'Falta la Secret Key en /admin/features → Stripe.' },
      { status: 503 },
    )
  }

  let body: CheckoutPayload
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 })
  }
  const interval = body.plan === 'monthly' ? 'monthly' : 'yearly'

  const plans = await listPlans(true)
  const plan = plans.find(p => p.id === 'premium')
  if (!plan) {
    return NextResponse.json({ ok: false, error: 'plan_unavailable' }, { status: 503 })
  }
  const cents = interval === 'monthly' ? plan.monthlyPriceCents : plan.yearlyPriceCents
  if (!cents || cents <= 0) {
    return NextResponse.json(
      { ok: false, error: 'price_missing', message: 'Configura el precio en /admin/plans primero.' },
      { status: 503 },
    )
  }

  // Redirect targets: SIEMPRE desde la env canónica (NEXT_PUBLIC_APP_URL),
  // nunca del header Origin controlado por el cliente.
  const origin = appOrigin(new URL(req.url).origin)
  try {
    const stripe = new Stripe(secretKey)
    // Prefer the admin-configured Stripe Price ID; fall back to inline
    // price_data so a plan without price IDs still checks out.
    const stripePriceId =
      interval === 'monthly' ? plan.stripePriceIdMonthly : plan.stripePriceIdYearly
    const lineItem: Stripe.Checkout.SessionCreateParams.LineItem = stripePriceId
      ? { quantity: 1, price: stripePriceId }
      : {
          quantity: 1,
          price_data: {
            currency: 'eur',
            unit_amount: cents,
            recurring: { interval: interval === 'monthly' ? 'month' : 'year' },
            product_data: { name: `${plan.nameEn} (${interval})` },
          },
        }
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer_email: body.email || undefined,
      line_items: [lineItem],
      metadata: { kind: 'premium' },
      subscription_data: { metadata: { kind: 'premium' } },
      success_url: `${origin}/manage?checkout=success`,
      cancel_url: `${origin}/premium?checkout=cancel`,
    })
    return NextResponse.json({ ok: true, url: session.url })
  } catch (err) {
    console.error('[checkout] premium session failed:', err)
    return NextResponse.json(
      { ok: false, error: 'stripe_error', message: 'No se pudo iniciar el pago. Revisa la configuración de Stripe.' },
      { status: 502 },
    )
  }
}
