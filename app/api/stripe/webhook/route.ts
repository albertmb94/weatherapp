/**
 * Stripe webhook receiver (B-NBT-10, Fase 5).
 *
 * - Signature verification via `feature_flags.config.webhook_secret`
 *   using constructEventAsync (Edge-compatible async crypto).
 * - checkout.session.completed  → provision subscription, mint the
 *   entitlement token and send the best-effort claim email with a
 *   /premium/claim?token=… link.
 * - customer.subscription.deleted → soft-cancel matching
 *   stripe_subscription_id.
 *
 * Acknowledged events return 200; handler failures return 500 so
 * Stripe retries. While feature.stripe is disabled events are REJECTED
 * with 503 so Stripe reintenta durante su ventana de 3 días (auditoría
 * S4: devolver 200 marcaba el evento como entregado y el pago se perdía
 * de forma definitiva y silenciosa).
 */

import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { getFeature } from '@/lib/features'
import {
  upsertSubscription,
  findEntitlementTokenByEmail,
  claimStripeEvent,
} from '@/lib/entitlements'
import { db } from '@/lib/db'
import { sendEmail } from '@/lib/emails'
import { appOrigin } from '@/lib/appUrl'

export async function POST(req: NextRequest) {
  const flag = await getFeature('feature.stripe')
  if (!flag.enabled) {
    // Auditoría S4: antes se devolvía 200 y Stripe daba el evento por
    // entregado — un pago real cobrado y nunca aprovisionado, sin
    // reintento posible. Con 503 Stripe reintenta durante 3 días, que es
    // margen de sobra para reactivar el flag. Combinado con el bug de
    // `feature_flags` inexistente (todas las flags a false en una BD
    // nueva), esta rama descartaba EL 100% de los pagos tras un
    // despliegue limpio.
    console.warn('[stripe] webhook recibido con feature.stripe DESACTIVADO — se pide reintento:', req.headers.get('stripe-signature') ? 'firmado' : 'sin firma')
    return NextResponse.json({ ok: false, error: 'stripe_feature_disabled' }, { status: 503 })
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

  // Idempotencia: Stripe reintenta por diseno y, sin esta guarda, cada
  // reintento reenviaba al cliente el email de activacion.
  try {
    if (!(await claimStripeEvent(event.id, event.type))) {
      return NextResponse.json({ ok: true, duplicate: true, type: event.type })
    }
  } catch (err) {
    // Si no podemos registrar el evento no sabemos si es duplicado:
    // pedimos reintento en vez de arriesgarnos a procesarlo dos veces.
    console.error('[stripe] no se pudo registrar el evento', err)
    return NextResponse.json({ ok: false, error: 'event_store_unavailable' }, { status: 503 })
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
          plan: item?.price.recurring?.interval === 'month' ? 'monthly' : 'yearly',
          currentPeriodEnd: periodEnd,
        })

        // Claim email: el cliente necesita el token para activar otros
        // dispositivos (/premium/claim fija la cookie wthr_entitlement).
        const token = await findEntitlementTokenByEmail(email, kind)
        if (token) {
          const claimUrl = `${appOrigin(req.nextUrl.origin)}/premium/claim?token=${token}`
          const result = await sendEmail({
            to: email,
            subject: kind === 'stations' ? 'Activa Estaciones en tus dispositivos' : 'Activa Premium en tus dispositivos',
            html:
              `<h1 style="font-size:22px;font-weight:600;margin:0 0 12px">¡Gracias por suscribirte!</h1>` +
              `<p style="margin:0 0 12px;line-height:1.5">Tu suscripción está activa. Pulsa el siguiente botón para activarla en este dispositivo:</p>` +
              `<p style="margin:0 0 16px"><a href="${claimUrl}" style="display:inline-block;background:#0a7aff;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:500">Activar suscripción</a></p>` +
              `<p style="margin:0 0 12px;line-height:1.5;color:#666">Si el botón no funciona, copia este enlace:<br/>${claimUrl}</p>` +
              `<p style="margin:0;line-height:1.5;color:#666">Podrás gestionar o cancelar tu suscripción desde <a href="${appOrigin(req.nextUrl.origin)}/manage" style="color:#0a7aff">Gestionar suscripción</a>.</p>`,
            plainText:
              `Tu suscripción está activa.\n\nActívala en este dispositivo entrando en:\n${claimUrl}\n\n` +
              `Gestiona o cancela tu suscripción en ${appOrigin(req.nextUrl.origin)}/manage`,
            metadata: { source: 'stripe_webhook', kind },
            sentBy: 'stripe-webhook',
          })
          if (!result.ok) {
            console.warn(`[stripe] claim email a ${email} no enviado (${result.error}); token disponible en /admin/users`)
          }
        }
        break
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription
        // executeOrThrow, no execute: la version anterior descartaba el
        // fallo (db.execute devuelve false y no lanza), asi que si Turso
        // estaba caida justo cuando llegaba la cancelacion, la fila
        // seguia en 'active' PARA SIEMPRE y el webhook respondia 200.
        // Nada mas expiraba la suscripcion.
        await db.executeOrThrow(
          `UPDATE subscriptions SET status = 'canceled', updated_at = ? WHERE stripe_subscription_id = ?`,
          [Date.now(), sub.id],
        )
        break
      }
      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription
        // Tambien se refresca el periodo pagado: antes solo se tocaba
        // `status`, asi que `current_period_end` nunca avanzaba en las
        // renovaciones y se quedaba en el valor del primer cobro.
        const item = sub.items.data[0]
        const periodEnd = item?.current_period_end ? item.current_period_end * 1000 : null
        if (periodEnd) {
          await db.executeOrThrow(
            `UPDATE subscriptions SET status = ?, current_period_end = ?, updated_at = ? WHERE stripe_subscription_id = ?`,
            [sub.status, periodEnd, Date.now(), sub.id],
          )
        } else {
          await db.executeOrThrow(
            `UPDATE subscriptions SET status = ?, updated_at = ? WHERE stripe_subscription_id = ?`,
            [sub.status, Date.now(), sub.id],
          )
        }
        break
      }
      default:
        break
    }
    return NextResponse.json({ ok: true, type: event.type })
  } catch (err) {
    console.error('[stripe] handler failed', err)
    // El evento queda registrado en stripe_events pero SIN procesar. Se
    // borra para que el reintento de Stripe vuelva a entrar: si no, la
    // guarda de idempotencia bloquearia el reintento y el pago se
    // perderia igualmente.
    try {
      await db.executeOrThrow('DELETE FROM stripe_events WHERE id = ?', [event.id])
    } catch (cleanupErr) {
      console.error('[stripe] no se pudo liberar el evento para reintento', cleanupErr)
    }
    return NextResponse.json({ ok: false, error: 'handler_failed' }, { status: 500 })
  }
}
