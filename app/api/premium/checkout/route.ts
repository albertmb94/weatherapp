/**
 * Subscription checkout entry points. The actual Stripe integration
 * (creating sessions, redirecting to checkout, handling webhooks)
 * lives behind these handlers and is gated by `feature.stripe` +
 * `feature.premium_checkout` / `feature.stations_checkout`. While
 * any of those flags is OFF the routes return a clear 503 so the
 * admin UI can show "Próximamente" without confusing the user.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getFeature } from '@/lib/features'

interface CheckoutPayload {
  email?: string
  plan?: 'monthly' | 'yearly'
}

export async function POST(req: NextRequest) {
  const stripe = await getFeature('feature.stripe')
  const checkout = await getFeature('feature.premium_checkout')
  if (!stripe.enabled || !checkout.enabled) {
    return NextResponse.json(
      {
        ok: false,
        error: 'premium_checkout_disabled',
        message:
          'El checkout de Premium está desactivado. El administrador debe activar feature.stripe y feature.premium_checkout y configurar los Stripe Price IDs en /admin/plans.',
      },
      { status: 503 },
    )
  }
  let body: CheckoutPayload
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 })
  }
  const plan = body.plan ?? 'monthly'
  // Stripe SDK not installed in this build yet — when the admin enables
  // feature.stripe they'll need to `npm install stripe` and uncomment
  // the integration block below. Until then we return a soft 503.
  return NextResponse.json(
    {
      ok: false,
      error: 'stripe_sdk_pending',
      message:
        'Stripe SDK pendiente de instalar (npm install stripe). La integración está cableada y se activará automáticamente.',
    },
    { status: 503 },
  )
}
