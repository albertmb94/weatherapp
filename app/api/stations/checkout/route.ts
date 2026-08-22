import { NextRequest, NextResponse } from 'next/server'
import { getFeature } from '@/lib/features'

interface CheckoutPayload {
  email?: string
  plan?: 'monthly' | 'yearly'
}

export async function POST(req: NextRequest) {
  const stripe = await getFeature('feature.stripe')
  const checkout = await getFeature('feature.stations_checkout')
  if (!stripe.enabled || !checkout.enabled) {
    return NextResponse.json(
      {
        ok: false,
        error: 'stations_checkout_disabled',
        message: 'El checkout de Estaciones está desactivado.',
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
  return NextResponse.json(
    {
      ok: false,
      error: 'stripe_sdk_pending',
      message: 'Stripe SDK pendiente. La integración está cableada.',
    },
    { status: 503 },
  )
}
