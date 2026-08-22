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
import { getFeature } from './features'

const COOKIE_NAME = 'wthr_entitlement'
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days sliding

let schemaReady: Promise<boolean> | null = null

async function ensureSchema(): Promise<boolean> {
  if (schemaReady) return schemaReady
  schemaReady = db.ensure().then(async ok => {
    if (!ok) return false
    try {
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
      await db.execute(
        `CREATE INDEX IF NOT EXISTS idx_sub_token ON subscriptions(entitlement_token)`,
      )
      await db.execute(
        `CREATE INDEX IF NOT EXISTS idx_sub_email ON subscriptions(email)`,
      )
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
      await db.execute(
        `CREATE INDEX IF NOT EXISTS idx_grants_email ON user_grants(email, kind)`,
      )
      return true
    } catch {
      return false
    }
  }).catch(() => false)
  return schemaReady
}

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
  const premium = p.premium
  const stations = p.stations
  if (premium && stations) {
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
  if (premium) {
    return {
      premium: true,
      stations: false,
      hasAny: true,
      maxModels: 999,
      maxDays: 14,
      maxSavedCities: 999,
      maxAffiliateSectionsPerDay: 2,
      showAds: false,
      pushAlerts: true,
      exportHistorical: true,
      canViewStationsTab: false,
    }
  }
  if (stations) {
    // Stations add-on without Premium: stations tab only, everything else free-tier.
    return {
      premium: false,
      stations: true,
      hasAny: true,
      maxModels: 7,
      maxDays: 7,
      maxSavedCities: 1,
      maxAffiliateSectionsPerDay: 1,
      showAds: true,
      pushAlerts: false,
      exportHistorical: false,
      canViewStationsTab: true,
    }
  }
  return {
    premium: false,
    stations: false,
    hasAny: false,
    maxModels: 7,
    maxDays: 7,
    maxSavedCities: 1,
    maxAffiliateSectionsPerDay: 1,
    showAds: true,
    pushAlerts: false,
    exportHistorical: false,
    canViewStationsTab: false,
  }
}

export function computeEntitlements(
  premium: boolean,
  stations: boolean,
): Entitlements {
  return featuresFor({ premium, stations })
}

export const FREE_ENTITLEMENTS = featuresFor({ premium: false, stations: false })

/** Read the entitlement cookie value and resolve it to the user's
 *  entitlement state. Returns the free-tier defaults when the cookie
 *  is missing, invalid or the DB is unavailable. */
export async function resolveEntitlements(token: string | undefined): Promise<Entitlements> {
  if (!token) return FREE_ENTITLEMENTS
  await ensureSchema()
  try {
    const rows = await db.select<{ kind: string; status: string }>(
      `SELECT kind, status FROM subscriptions WHERE entitlement_token = ? AND status IN ('active','trialing')`,
      [token],
    )
    const premium = rows.some(r => r.kind === 'premium')
    const stations = rows.some(r => r.kind === 'stations')
    return computeEntitlements(premium, stations)
  } catch {
    return FREE_ENTITLEMENTS
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
  try {
    await db.execute(
      `INSERT INTO subscriptions (email, kind, stripe_customer_id, stripe_subscription_id, status, plan, current_period_end, entitlement_token, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(stripe_subscription_id) DO UPDATE SET
         email = excluded.email,
         kind = excluded.kind,
         stripe_customer_id = COALESCE(excluded.stripe_customer_id, subscriptions.stripe_customer_id),
         status = excluded.status,
         plan = excluded.plan,
         current_period_end = excluded.current_period_end,
         updated_at = excluded.updated_at`,
      [
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
    )
  } catch (err) {
    console.warn('[entitlements] upsertSubscription failed', err)
  }
  return token
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
