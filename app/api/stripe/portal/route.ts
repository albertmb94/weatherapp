import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { cookies } from 'next/headers'
import { getFeature } from '@/lib/features'
import {
  ENTITLEMENT_COOKIE_NAME,
  findEmailByToken,
} from '@/lib/entitlements'
import { db } from '@/lib/db'

/**
 * B-NBT-10: creates a Stripe Billing Portal session for the current
 * entitlement holder and redirects to it. Requires feature.stripe ON,
 * a configured secret key, and an existing subscription with a Stripe
 * customer id (created at checkout).
 */
export async function GET(req: NextRequest) {
  const flag = await getFeature('feature.stripe')
  const origin = req.nextUrl.origin
  if (!flag.enabled) {
    return NextResponse.redirect(`${origin}/manage?portal=disabled`)
  }
  const secretKey = String(flag.config.secret_key ?? '')
  if (!secretKey.startsWith('sk_')) {
    return NextResponse.redirect(`${origin}/manage?portal=not_configured`)
  }

  const cookieStore = await cookies()
  const token = cookieStore.get(ENTITLEMENT_COOKIE_NAME)?.value
  const email = token ? await findEmailByToken(token) : null
  if (!email) {
    return NextResponse.redirect(`${origin}/manage?portal=no_subscription`)
  }
  const rows = await db.select<{ stripe_customer_id: string | null }>(
    `SELECT stripe_customer_id FROM subscriptions
     WHERE email = ? AND stripe_customer_id IS NOT NULL
     ORDER BY created_at DESC LIMIT 1`,
    [email],
  )
  const customerId = rows[0]?.stripe_customer_id ?? null
  if (!customerId || typeof customerId !== 'string') {
    return NextResponse.redirect(`${origin}/manage?portal=no_customer`)
  }

  try {
    const stripe = new Stripe(secretKey)
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${origin}/manage`,
    })
    return NextResponse.redirect(session.url)
  } catch (err) {
    console.warn('[stripe] portal failed', err instanceof Error ? err.message : err)
    return NextResponse.redirect(`${origin}/manage?portal=error`)
  }
}
