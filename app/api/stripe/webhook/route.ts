import { NextRequest, NextResponse } from 'next/server'
import { getFeature } from '@/lib/features'

/** Stripe webhook receiver. Always returns 200 (even when disabled)
 *  so a misconfigured webhook in the Stripe dashboard doesn't pile
 *  up retries. When feature.stripe is OFF we just acknowledge. */
export async function POST(req: NextRequest) {
  const stripe = await getFeature('feature.stripe')
  if (!stripe.enabled) {
    return NextResponse.json({ ok: true, ignored: true })
  }
  // Stripe SDK + signature verification pending. The route exists so
  // the admin can paste the webhook URL in Stripe without surprises.
  return NextResponse.json({ ok: true, message: 'webhook received (integration pending)' })
}
