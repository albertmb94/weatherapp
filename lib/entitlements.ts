/**
 * Entitlements — describes what a given user (identified by their
 * entitlement cookie) is allowed to do across the app. Combines two
 * independent axes: a tier (free / premium) and an add-on
 * (stations). Each axis is backed by a row in the `subscriptions`
 * table so a user can have premium+stations, just stations, just
 * premium, or nothing.
 *
 * The shape is plain data so server components and client hooks can
 * consume it without pulling in the rest of the admin code.
 */

import { randomBytes } from 'crypto'
import { db } from './db'
import { memoizeSchema } from './schemaGuard'

const COOKIE_NAME = 'wthr_entitlement'
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days sliding

const ensureSchema = memoizeSchema('entitlements', async () => {
  await db.execute(
    `CREATE TABLE IF NOT EXISTS subscriptions (
      email TEXT NOT NULL,
      kind TEXT NOT NULL,
      stripe_customer_id TEXT,
      stripe_subscription_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      plan TEXT NOT NULL,
      current_period_end INTEGER NOT NULL,
      entitlement_token TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(email, kind)
    )`,
  )
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_sub_token ON subscriptions(entitlement_token)`)
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_sub_email ON subscriptions(email)`)
  // Backwards compat: copy from premium_subscriptions if that table exists.
  try {
    await db.execute(
      `INSERT OR IGNORE INTO subscriptions
        (email, kind, stripe_customer_id, stripe_subscription_id, status, plan, current_period_end, entitlement_token, created_at, updated_at)
       SELECT email, 'premium', stripe_customer_id, stripe_subscription_id, status, plan, current_period_end, entitlement_token, created_at, updated_at
       FROM premium_subscriptions`,
    )
  } catch {
    /* premium_subscriptions may not exist — that's fine */
  }
  // Manual grants (admin can gift a subscription without Stripe)
  await db.execute(
    `CREATE TABLE IF NOT EXISTS user_grants (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      kind TEXT NOT NULL,
      reason TEXT,
      granted_by TEXT NOT NULL,
      granted_at INTEGER NOT NULL,
      expires_at INTEGER,
      revoked_at INTEGER
    )`,
  )
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_grants_email ON user_grants(email, kind)`)

  // Idempotencia del webhook. Sin esto, cada reintento de Stripe
  // reprocesaba el evento entero y REENVIABA el email de activacion al
  // cliente. Stripe reintenta por diseno (fallos de red, timeouts), asi
  // que no era un caso hipotetico.
  await db.execute(
    `CREATE TABLE IF NOT EXISTS stripe_events (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      received_at INTEGER NOT NULL
    )`,
  )
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_stripe_events_at ON stripe_events(received_at)`)
})

export interface Entitlements {
  premium: boolean
  stations: boolean
  /** Derived convenience flags. */
  hasAny: boolean
  // Feature flags derived from entitlements
  maxModels: number
  maxDays: number
  maxSavedCities: number
  maxAffiliateSectionsPerDay: number
  showAds: boolean
  pushAlerts: boolean
  exportHistorical: boolean
  canViewStationsTab: boolean
}

function featuresFor(p: { premium: boolean; stations: boolean }): Entitlements {
  // B-NBT-14 (2026-08-22): TODOS los usuarios ven TODO — sin restricciones.
  // El owner pidió explícitamente que nadie tenga limitaciones mientras
  // la monetización no esté activa. Cuando se quiera reintroducir el
  // paywall, restaurar las matrices por plan (ver git history).
  void p
  return {
    premium: true,
    stations: true,
    hasAny: true,
    maxModels: 999,
    maxDays: 14,
    maxSavedCities: 999,
    maxAffiliateSectionsPerDay: 3,
    showAds: false,
    pushAlerts: true,
    exportHistorical: true,
    canViewStationsTab: true,
  }
}

export function computeEntitlements(
  premium: boolean,
  stations: boolean,
): Entitlements {
  return featuresFor({ premium, stations })
}

export const FREE_ENTITLEMENTS = featuresFor({ premium: false, stations: false })

/** Margen tras el fin de periodo: Stripe puede tardar en emitir la
 *  renovacion y no queremos cortarle el servicio a quien ha pagado. */
export const RENEWAL_GRACE_MS = 3 * 24 * 60 * 60 * 1000

export interface ActiveKinds {
  premium: boolean
  stations: boolean
}

/**
 * Que suscripciones tiene VIVAS este token, segun la base de datos.
 *
 * Deliberadamente separado de `resolveEntitlements`: hoy `featuresFor`
 * devuelve todo desbloqueado para todo el mundo (decision de producto
 * B-NBT-14), asi que el estado real de las suscripciones no es
 * observable a traves del objeto de permisos. Sin esta funcion, la
 * comprobacion de caducidad no se podria ni testear ni auditar hasta que
 * se reactive la matriz de planes.
 *
 * Dos barreras: el estado Y el periodo pagado. `current_period_end` se
 * escribia pero no se consultaba —era una columna decorativa— y,
 * combinado con que un webhook de cancelacion fallido dejaba la fila en
 * 'active' (db.execute tragaba el error y el webhook respondia 200),
 * nada expiraba jamas una suscripcion.
 */
export async function resolveActiveKinds(
  token: string | undefined,
  now = Date.now(),
): Promise<ActiveKinds> {
  if (!token) return { premium: false, stations: false }
  await ensureSchema()
  try {
    const rows = await db.select<{ kind: string; status: string; current_period_end: number }>(
      `SELECT kind, status, current_period_end FROM subscriptions
       WHERE entitlement_token = ? AND status IN ('active','trialing')`,
      [token],
    )
    const vivos = rows.filter(r => {
      const end = Number(r.current_period_end)
      // Una fila sin periodo (datos antiguos) no se penaliza.
      if (!Number.isFinite(end) || end <= 0) return true
      return end + RENEWAL_GRACE_MS > now
    })
    return {
      premium: vivos.some(r => r.kind === 'premium'),
      stations: vivos.some(r => r.kind === 'stations'),
    }
  } catch {
    return { premium: false, stations: false }
  }
}

/** Read the entitlement cookie value and resolve it to the user's
 *  entitlement state. Returns the free-tier defaults when the cookie
 *  is missing, invalid or the DB is unavailable. */
export async function resolveEntitlements(token: string | undefined): Promise<Entitlements> {
  if (!token) return FREE_ENTITLEMENTS
  const { premium, stations } = await resolveActiveKinds(token)
  return computeEntitlements(premium, stations)
}

/** Corresponde este token a una suscripcion REAL en la base de datos?
 *
 *  Existe porque `featuresFor` devuelve hoy `hasAny: true` para todo el
 *  mundo (decision de producto B-NBT-14), de modo que el guard de
 *  /api/premium/claim —que comprobaba `ent.hasAny`— era un no-op:
 *  cualquier cadena hexadecimal de 16-64 caracteres acunaba la cookie de
 *  30 dias. Inocuo mientras todo este desbloqueado, bypass el dia que se
 *  reactive la matriz de planes. */
export async function entitlementTokenExists(token: string): Promise<boolean> {
  await ensureSchema()
  try {
    const rows = await db.select<{ n: number }>(
      'SELECT COUNT(*) AS n FROM subscriptions WHERE entitlement_token = ?',
      [token],
    )
    return Number(rows[0]?.n ?? 0) > 0
  } catch {
    return false
  }
}

/** Look up a customer by email — used by Stripe webhook to attach
 *  subscriptions to the entitlement token. */
export async function findEntitlementTokenByEmail(
  email: string,
  kind: string,
): Promise<string | null> {
  await ensureSchema()
  try {
    const rows = await db.select<{ entitlement_token: string }>(
      `SELECT entitlement_token FROM subscriptions WHERE email = ? AND kind = ?`,
      [email.toLowerCase(), kind],
    )
    return rows[0]?.entitlement_token ?? null
  } catch {
    return null
  }
}

/** B-NBT-10: the email behind an entitlement token (or null). Used at
 *  claim time to link the anonymous device id with a known user. */
export async function findEmailByToken(token: string): Promise<string | null> {
  await ensureSchema()
  try {
    const rows = await db.select<{ email: string }>(
      'SELECT email FROM subscriptions WHERE entitlement_token = ? LIMIT 1',
      [token],
    )
    return rows[0]?.email ?? null
  } catch {
    return null
  }
}

export async function upsertSubscription(input: {
  email: string
  kind: 'premium' | 'stations'
  stripeCustomerId?: string | null
  stripeSubscriptionId: string
  status: string
  plan: 'monthly' | 'yearly'
  currentPeriodEnd: number
  entitlementToken?: string
}): Promise<string> {
  await ensureSchema()
  const email = input.email.toLowerCase()
  const token =
    input.entitlementToken ??
    (await findEntitlementTokenByEmail(email, input.kind)) ??
    randomBytes(20).toString('hex')
  const now = Date.now()
  // La tabla tiene DOS restricciones unicas —`stripe_subscription_id`
  // como PK y UNIQUE(email, kind)— y el upsert solo contemplaba la
  // primera. Un cliente que cancelaba y volvia a suscribirse recibia un
  // `sub_...` NUEVO con el mismo (email, kind): violacion de constraint,
  // que `db.execute` se tragaba devolviendo false, que el catch
  // convertia en un warning... y el webhook respondia 200. Pago cobrado,
  // fila sin actualizar, nadie enterado.
  //
  // Se borra primero la fila anterior de ese (email, kind) —el token de
  // permiso ya se ha rescatado arriba, asi que el cliente conserva su
  // enlace de activacion— y ambas sentencias van en el MISMO lote
  // atomico. Ademas ahora LANZA: el webhook necesita poder devolver 5xx
  // para que Stripe reintente.
  await db.batchOrThrow([
    {
      sql: 'DELETE FROM subscriptions WHERE email = ? AND kind = ? AND stripe_subscription_id <> ?',
      args: [email, input.kind, input.stripeSubscriptionId],
    },
    {
      sql: `INSERT INTO subscriptions (email, kind, stripe_customer_id, stripe_subscription_id, status, plan, current_period_end, entitlement_token, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(stripe_subscription_id) DO UPDATE SET
         email = excluded.email,
         kind = excluded.kind,
         stripe_customer_id = COALESCE(excluded.stripe_customer_id, subscriptions.stripe_customer_id),
         status = excluded.status,
         plan = excluded.plan,
         current_period_end = excluded.current_period_end,
         updated_at = excluded.updated_at`,
      args: [
        email,
        input.kind,
        input.stripeCustomerId ?? null,
        input.stripeSubscriptionId,
        input.status,
        input.plan,
        input.currentPeriodEnd,
        token,
        now,
        now,
      ],
    },
  ])
  return token
}

/**
 * Registra un evento de Stripe. Devuelve true si es la PRIMERA vez que
 * se ve (hay que procesarlo) y false si ya estaba (reintento).
 */
export async function claimStripeEvent(eventId: string, type: string): Promise<boolean> {
  await ensureSchema()
  const before = await db.select<{ n: number }>(
    'SELECT COUNT(*) AS n FROM stripe_events WHERE id = ?',
    [eventId],
  )
  if (Number(before[0]?.n ?? 0) > 0) return false
  await db.executeOrThrow(
    'INSERT OR IGNORE INTO stripe_events (id, type, received_at) VALUES (?, ?, ?)',
    [eventId, type, Date.now()],
  )
  return true
}

export async function listSubscriptions(): Promise<
  {
    email: string
    kind: string
    status: string
    plan: string
    currentPeriodEnd: number
    stripeSubscriptionId: string
    createdAt: number
  }[]
> {
  await ensureSchema()
  try {
    const rows = await db.select<{
      email: string
      kind: string
      status: string
      plan: string
      current_period_end: number
      stripe_subscription_id: string
      created_at: number
    }>('SELECT email, kind, status, plan, current_period_end, stripe_subscription_id, created_at FROM subscriptions ORDER BY created_at DESC')
    return rows.map(r => ({
      email: r.email,
      kind: r.kind,
      status: r.status,
      plan: r.plan,
      currentPeriodEnd: Number(r.current_period_end),
      stripeSubscriptionId: r.stripe_subscription_id,
      createdAt: Number(r.created_at),
    }))
  } catch {
    return []
  }
}

export async function listActiveEntitlementTokens(): Promise<string[]> {
  await ensureSchema()
  try {
    const rows = await db.select<{ entitlement_token: string }>(
      `SELECT DISTINCT entitlement_token FROM subscriptions WHERE status IN ('active','trialing')`,
    )
    return rows.map(r => r.entitlement_token)
  } catch {
    return []
  }
}

export async function countActiveSubscriptions(): Promise<{ premium: number; stations: number }> {
  await ensureSchema()
  try {
    const rows = await db.select<{ kind: string; n: number }>(
      `SELECT kind, COUNT(*) AS n FROM subscriptions WHERE status IN ('active','trialing') GROUP BY kind`,
    )
    const out = { premium: 0, stations: 0 }
    for (const r of rows) {
      if (r.kind === 'premium') out.premium = Number(r.n)
      else if (r.kind === 'stations') out.stations = Number(r.n)
    }
    return out
  } catch {
    return { premium: 0, stations: 0 }
  }
}

export const ENTITLEMENT_COOKIE_NAME = COOKIE_NAME
export const ENTITLEMENT_TOKEN_TTL_MS = TOKEN_TTL_MS
