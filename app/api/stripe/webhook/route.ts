/**
 * Stripe webhook receiver (B-NBT-10, Fase 5).
 *
 * - Signature verification via `feature_flags.config.webhook_secret`
 *   using constructEventAsync (Edge-compatible async crypto).
 * - checkout.session.completed  → provision subscription + mint the
 *   entitlement token, then best-effort claim email.
 * - customer.subscription.deleted → soft-cancel matching
 *   stripe_subscription_id.
 *
 * Always returns 200 for acknowledged events so Stripe doesn't retry.
 */

import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { getFeature } from '@/lib/features'
import {
  upsertSubscription,
  findEntitlementTokenByEmail,
} from '@/lib/entitlements'

function intervalToMs(interval: string | undefined): number {
  if (interval === 'month') return 30 * 86_400_000
  return 365 * 86_400_000
}

export async function POST(req: NextRequest) {
  const flag = await getFeature('feature.stripe')
  if (!flag.enabled) {
    return NextResponse.json({ ok: true, ignored: true })
  }
  const secretKey = String(flag.config.secret_key ?? '')
  const webhookSecret = String(flag.config.webhook_secret ?? '')
  if (!secretKey.startsWith('sk_') || !webhookSecret) {
    return NextResponse.json({ ok: false, error: 'stripe_not_configured' }, { status: 503 })
  }

  const signature = req.headers.get('stripe-signature') ?? ''
  const payload = await req.text()
  const stripe = new Stripe(secretKey)

  let event: Stripe.Event
  try {
    event = await stripe.webhooks.constructEventAsync(payload, signature, webhookSecret)
  } catch (err) {
    console.warn('[stripe] bad signature', err instanceof Error ? err.message : err)
    return NextResponse.json({ ok: false, error: 'bad_signature' }, { status: 400 })
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        const kind = session.metadata?.kind === 'stations' ? 'stations' : 'premium'
        const email = session.customer_details?.email ?? session.customer_email ?? null
        if (!email || !session.subscription) break

        // Pull the subscription to learn the real period end.
        const sub = await stripe.subscriptions.retrieve(session.subscription as string)
        const item = sub.items.data[0]
        const periodEnd = (item?.current_period_end ?? Math.floor(Date.now() / 1000)) * 1000

        await upsertSubscription({
          email,
          kind,
          stripeCustomerId: typeof session.customer === 'string' ? session.customer : null,
          stripeSubscriptionId: sub.id,
          status: sub.status,
          plan: intervalToMs(item?.price.recurring?.interval) < 200 * 86_400_000 ? 'monthly' : 'yearly',
          currentPeriodEnd: periodEnd,
        })

        // Best-effort claim email so the user can activate other devices.
        const token = await findEntitlementTokenByEmail(email, kind)
        if (token) {
          console.info(`[stripe] provisioned ${kind} for ${email}; token ready for /premium/claim`)
          // Email delivery is wired in lib/emails.sendEmail — intentionally
          // not sent here until an admin-approved template exists, to avoid
          // leaking tokens into logs. The token is visible in /admin/users.
        }
        break
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription
        const { db } = await import('@/lib/db')
        await db.execute(
          `UPDATE subscriptions SET status = 'canceled', updated_at = ? WHERE stripe_subscription_id = ?`,
          [Date.now(), sub.id],
        )
        break
      }
      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription
        const { db } = await import('@/lib/db')
        await db.execute(
          `UPDATE subscriptions SET status = ?, updated_at = ? WHERE stripe_subscription_id = ?`,
          [sub.status, Date.now(), sub.id],
        )
        break
      }
      default:
        break
    }
    return NextResponse.json({ ok: true, type: event.type })
  } catch (err) {
    console.error('[stripe] handler failed', err)
    return NextResponse.json({ ok: false, error: 'handler_failed' }, { status: 500 })
  }
}
