/**
 * Stations add-on checkout (B-NBT-10, Fase 5). Mirrors
 * /api/premium/checkout with kind='stations'.
 */

import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { getFeature } from '@/lib/features'
import { listPlans } from '@/lib/plans'

interface CheckoutPayload {
  email?: string
  plan?: 'monthly' | 'yearly'
}

export async function POST(req: NextRequest) {
  const stripeFlag = await getFeature('feature.stripe')
  const checkout = await getFeature('feature.stations_checkout')
  if (!stripeFlag.enabled || !checkout.enabled) {
    return NextResponse.json(
      { ok: false, error: 'stations_checkout_disabled', message: 'El checkout de Estaciones está desactivado.' },
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
  const plan = plans.find(p => p.id === 'stations')
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

  const origin = req.headers.get('origin') ?? new URL(req.url).origin
  try {
    const stripe = new Stripe(secretKey)
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer_email: body.email || undefined,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'eur',
            unit_amount: cents,
            recurring: { interval: interval === 'monthly' ? 'month' : 'year' },
            product_data: { name: `${plan.nameEn} (${interval})` },
          },
        },
      ],
      metadata: { kind: 'stations' },
      subscription_data: { metadata: { kind: 'stations' } },
      success_url: `${origin}/manage?checkout=success`,
      cancel_url: `${origin}/premium/estaciones?checkout=cancel`,
    })
    return NextResponse.json({ ok: true, url: session.url })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: 'stripe_error', message }, { status: 502 })
  }
}
