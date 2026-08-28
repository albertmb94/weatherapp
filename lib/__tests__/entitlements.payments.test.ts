import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'

vi.hoisted(() => {
  process.env.TURSO_DATABASE_URL = 'file::memory:'
  delete process.env.TURSO_AUTH_TOKEN
})

import { db } from '@/lib/db'
import {
  upsertSubscription,
  resolveEntitlements,
  resolveActiveKinds,
  entitlementTokenExists,
  findEntitlementTokenByEmail,
  claimStripeEvent,
} from '@/lib/entitlements'

const DIA = 24 * 60 * 60 * 1000

async function filas(email: string) {
  return db.selectOrThrow<{
    stripe_subscription_id: string
    status: string
    entitlement_token: string
    current_period_end: number
  }>(
    'SELECT stripe_subscription_id, status, entitlement_token, current_period_end FROM subscriptions WHERE email = ?',
    [email],
  )
}

beforeAll(async () => {
  expect(await db.ensure()).toBe(true)
  // Fuerza la creación del esquema del módulo.
  await upsertSubscription({
    email: 'bootstrap@example.com',
    kind: 'premium',
    stripeSubscriptionId: 'sub_bootstrap',
    status: 'active',
    plan: 'monthly',
    currentPeriodEnd: Date.now() + 30 * DIA,
  })
})

beforeEach(async () => {
  await db.executeOrThrow('DELETE FROM subscriptions')
  await db.executeOrThrow('DELETE FROM stripe_events')
})

describe('resuscripción (cliente que cancela y vuelve)', () => {
  it('la segunda suscripción SUSTITUYE a la primera sin violar UNIQUE(email, kind)', async () => {
    // El bug: la tabla tiene dos restricciones únicas y el upsert sólo
    // manejaba ON CONFLICT(stripe_subscription_id). Un `sub_...` nuevo
    // con el mismo (email, kind) violaba la otra, `db.execute` se lo
    // tragaba devolviendo false, el catch lo degradaba a warning y el
    // webhook respondía 200: pago cobrado, fila sin actualizar.
    const email = 'vuelve@example.com'
    await upsertSubscription({
      email,
      kind: 'premium',
      stripeSubscriptionId: 'sub_primera',
      status: 'canceled',
      plan: 'monthly',
      currentPeriodEnd: Date.now() - 10 * DIA,
    })
    await upsertSubscription({
      email,
      kind: 'premium',
      stripeSubscriptionId: 'sub_segunda',
      status: 'active',
      plan: 'yearly',
      currentPeriodEnd: Date.now() + 365 * DIA,
    })

    const rows = await filas(email)
    expect(rows).toHaveLength(1)
    expect(rows[0].stripe_subscription_id).toBe('sub_segunda')
    expect(rows[0].status).toBe('active')
  })

  it('conserva el MISMO token de permiso: el enlace de activación del cliente sigue valiendo', async () => {
    const email = 'token@example.com'
    const t1 = await upsertSubscription({
      email, kind: 'premium', stripeSubscriptionId: 'sub_a',
      status: 'canceled', plan: 'monthly', currentPeriodEnd: Date.now() - DIA,
    })
    const t2 = await upsertSubscription({
      email, kind: 'premium', stripeSubscriptionId: 'sub_b',
      status: 'active', plan: 'monthly', currentPeriodEnd: Date.now() + 30 * DIA,
    })
    expect(t2).toBe(t1)
    expect(await findEntitlementTokenByEmail(email, 'premium')).toBe(t1)
  })

  it('premium y stations del mismo email conviven', async () => {
    const email = 'ambos@example.com'
    await upsertSubscription({
      email, kind: 'premium', stripeSubscriptionId: 'sub_p',
      status: 'active', plan: 'monthly', currentPeriodEnd: Date.now() + 30 * DIA,
    })
    await upsertSubscription({
      email, kind: 'stations', stripeSubscriptionId: 'sub_s',
      status: 'active', plan: 'monthly', currentPeriodEnd: Date.now() + 30 * DIA,
    })
    expect(await filas(email)).toHaveLength(2)
  })

  it('propaga el fallo en vez de tragárselo (el webhook necesita poder devolver 5xx)', async () => {
    await db.executeOrThrow('ALTER TABLE subscriptions RENAME TO subscriptions_tmp')
    try {
      await expect(
        upsertSubscription({
          email: 'x@example.com', kind: 'premium', stripeSubscriptionId: 'sub_x',
          status: 'active', plan: 'monthly', currentPeriodEnd: Date.now(),
        }),
      ).rejects.toThrow()
    } finally {
      await db.executeOrThrow('ALTER TABLE subscriptions_tmp RENAME TO subscriptions')
    }
  })
})

describe('caducidad (resolveActiveKinds)', () => {
  // Se comprueba contra `resolveActiveKinds` y no contra
  // `resolveEntitlements`: hoy `featuresFor` devuelve premium/stations a
  // true para TODO el mundo (decision de producto B-NBT-14), asi que el
  // estado real de la suscripcion no es observable a traves del objeto
  // de permisos. Esta separacion es justo lo que hace auditable la
  // caducidad mientras el paywall siga desactivado.
  it('una suscripción activa dentro del periodo cuenta como viva', async () => {
    const token = await upsertSubscription({
      email: 'viva@example.com', kind: 'premium', stripeSubscriptionId: 'sub_viva',
      status: 'active', plan: 'monthly', currentPeriodEnd: Date.now() + 10 * DIA,
    })
    expect(await resolveActiveKinds(token)).toEqual({ premium: true, stations: false })
  })

  it('respeta el margen de 3 días tras el fin de periodo', async () => {
    const token = await upsertSubscription({
      email: 'margen@example.com', kind: 'premium', stripeSubscriptionId: 'sub_margen',
      status: 'active', plan: 'monthly', currentPeriodEnd: Date.now() - 1 * DIA,
    })
    expect((await resolveActiveKinds(token)).premium).toBe(true)
  })

  it('una fila "active" con el periodo MUY vencido ya NO cuenta como viva', async () => {
    // Es el escenario del webhook de cancelación perdido: sin comprobar
    // `current_period_end`, la fila se quedaba en 'active' para siempre y
    // nada expiraba la suscripción jamás.
    const token = await upsertSubscription({
      email: 'zombi@example.com', kind: 'premium', stripeSubscriptionId: 'sub_zombi',
      status: 'active', plan: 'monthly', currentPeriodEnd: Date.now() - 90 * DIA,
    })
    expect((await resolveActiveKinds(token)).premium).toBe(false)
  })

  it('justo en la frontera del margen: dentro vale, fuera no', async () => {
    const ahora = Date.UTC(2026, 7, 27, 12, 0)
    const token = await upsertSubscription({
      email: 'frontera@example.com', kind: 'premium', stripeSubscriptionId: 'sub_frontera',
      status: 'active', plan: 'monthly', currentPeriodEnd: ahora - 2.9 * DIA,
    })
    expect((await resolveActiveKinds(token, ahora)).premium).toBe(true)
    expect((await resolveActiveKinds(token, ahora + 0.2 * DIA)).premium).toBe(false)
  })

  it('un estado no activo nunca cuenta, por muy vigente que sea el periodo', async () => {
    const token = await upsertSubscription({
      email: 'cancelada@example.com', kind: 'premium', stripeSubscriptionId: 'sub_cancelada',
      status: 'canceled', plan: 'monthly', currentPeriodEnd: Date.now() + 300 * DIA,
    })
    expect((await resolveActiveKinds(token)).premium).toBe(false)
  })

  it('una fila sin periodo (datos antiguos) no se penaliza', async () => {
    const token = 'a'.repeat(40)
    await db.executeOrThrow(
      `INSERT INTO subscriptions (email, kind, stripe_subscription_id, status, plan, current_period_end, entitlement_token, created_at, updated_at)
       VALUES ('legacy@example.com', 'premium', 'sub_legacy', 'active', 'monthly', 0, ?, 0, 0)`,
      [token],
    )
    expect((await resolveActiveKinds(token)).premium).toBe(true)
  })

  it('sin token no hay nada vivo', async () => {
    expect(await resolveActiveKinds(undefined)).toEqual({ premium: false, stations: false })
  })

  it('el paywall sigue desbloqueado a proposito: resolveEntitlements da premium igualmente', async () => {
    // Documenta la decision B-NBT-14 en vez de dejarla implicita. Si
    // alguien reactiva la matriz de planes, este test fallara y le
    // recordara que `resolveActiveKinds` es la fuente de verdad.
    const ent = await resolveEntitlements('token-inventado')
    expect(ent.premium).toBe(true)
  })
})

describe('entitlementTokenExists (guard del claim)', () => {
  it('reconoce un token real', async () => {
    const token = await upsertSubscription({
      email: 'real@example.com', kind: 'premium', stripeSubscriptionId: 'sub_real',
      status: 'active', plan: 'monthly', currentPeriodEnd: Date.now() + 30 * DIA,
    })
    expect(await entitlementTokenExists(token)).toBe(true)
  })

  it('RECHAZA un hexadecimal inventado', async () => {
    // El guard anterior comprobaba `ent.hasAny`, hardcodeado a true, así
    // que esta cadena acuñaba una cookie de 30 días para un token que no
    // existía en ninguna fila.
    expect(await entitlementTokenExists('aaaaaaaaaaaaaaaa')).toBe(false)
    expect(await entitlementTokenExists('deadbeef'.repeat(4))).toBe(false)
  })
})

describe('idempotencia de eventos de Stripe', () => {
  it('el primer intento reclama el evento y el segundo no', async () => {
    expect(await claimStripeEvent('evt_1', 'checkout.session.completed')).toBe(true)
    expect(await claimStripeEvent('evt_1', 'checkout.session.completed')).toBe(false)
    expect(await claimStripeEvent('evt_1', 'checkout.session.completed')).toBe(false)
  })

  it('eventos distintos se procesan por separado', async () => {
    expect(await claimStripeEvent('evt_a', 'x')).toBe(true)
    expect(await claimStripeEvent('evt_b', 'x')).toBe(true)
  })

  it('deja rastro del tipo y la hora para poder auditarlo', async () => {
    await claimStripeEvent('evt_audit', 'customer.subscription.deleted')
    const rows = await db.selectOrThrow<{ type: string; received_at: number }>(
      'SELECT type, received_at FROM stripe_events WHERE id = ?', ['evt_audit'],
    )
    expect(rows[0].type).toBe('customer.subscription.deleted')
    expect(Number(rows[0].received_at)).toBeGreaterThan(0)
  })
})
