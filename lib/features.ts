/**
 * Feature flags â€” single source of truth for which monetisation features
 * are currently active. Every feature reads through `getFeature()` so
 * the admin panel can toggle each one without a redeploy.
 *
 * Defaults to OFF for every flag. The `seed` row in the migration
 * pre-populates the catalogue so the admin UI can render a list even
 * before anyone has clicked a toggle.
 */

import { cache } from 'react'
import { db } from './db'

export interface FeatureFlag {
  enabled: boolean
  config: Record<string, unknown>
  description?: string
}

/** Cache the lookup within a single request so multiple consumers in the
 *  same render don't hit the DB repeatedly.
 *
 *  B-NBT-9c (2026-08-22): `revalidateFeature()` used to write into a
 *  module-level Map that getFeature() merely "touched" â€” reading a Map
 *  invalidates nothing, and React's cache() is per-request anyway, so
 *  both halves of the machinery were no-ops dressed up as an
 *  invalidation mechanism. Removed: admin writes take effect on the
 *  next request naturally (each request gets a fresh cache()). The
 *  function remains as a no-op so existing callers keep compiling;
 *  delete it once the admin panel stops calling it. */
export function revalidateFeature(_key?: string): void {
  void _key
}

async function loadFeature(key: string): Promise<FeatureFlag> {
  try {
    const rows = await db.select<{
      enabled: number | string
      config: string | null
      description: string | null
    }>('SELECT enabled, config, description FROM feature_flags WHERE key = ?', [key])
    if (!rows[0]) return { enabled: false, config: {} }
    return {
      enabled: Number(rows[0].enabled) === 1,
      config: rows[0].config ? JSON.parse(rows[0].config) : {},
      description: rows[0].description ?? undefined,
    }
  } catch {
    return { enabled: false, config: {} }
  }
}

/** React cache() so per-request dedupe works in server components.
 *  Admin toggles take effect on the next request automatically â€” there
 *  is no cross-request cache to bust (see B-NBT-9c note above). */
export const getFeature = cache(async (key: string): Promise<FeatureFlag> => {
  return loadFeature(key)
})

export async function isFeatureEnabled(key: string): Promise<boolean> {
  return (await getFeature(key)).enabled
}

export async function getFeatureConfig<T = Record<string, unknown>>(
  key: string,
): Promise<T> {
  return (await getFeature(key)).config as T
}

/** All known feature keys. Kept in code (not DB) so the admin UI can
 *  render a stable catalogue even when the migration hasn't run yet.
 *  The seed migration inserts these rows so toggling works out of the
 *  box after the first request. */
export const FEATURE_KEYS = {
  PREMIUM_CHECKOUT: 'feature.premium_checkout',
  STATIONS_CHECKOUT: 'feature.stations_checkout',
  AFFILIATES: 'feature.affiliates',
  AFFILIATES_AMAZON: 'feature.affiliates.amazon',
  ADS_ADSENSE: 'feature.ads.adsense',
  ADS_ETHICALADS: 'feature.ads.ethicalads',
  COOKIEBOT: 'feature.cookiebot',
  PLAUSIBLE: 'feature.plausible',
  NEWSLETTER: 'feature.newsletter',
  PUSH: 'feature.push',
  KOFI: 'feature.kofi',
  GITHUB_SPONSORS: 'feature.githubsponsors',
  STRIPE: 'feature.stripe',
  RESEND: 'feature.resend',
  BUTTONDOWN: 'feature.buttondown',
  METRICS_DASHBOARD: 'feature.metrics_dashboard',
  FEATURE_FLAGS_ADMIN: 'feature.feature_flags_admin',
  ANOMALY_ALERTS: 'feature.anomaly_alerts',
} as const

export type FeatureKey = (typeof FEATURE_KEYS)[keyof typeof FEATURE_KEYS]

interface FeatureMeta {
  key: FeatureKey
  label: string
  description: string
  category: 'monetization' | 'analytics' | 'infrastructure'
  configSchema?: { key: string; label: string; type: 'string' | 'number' | 'boolean' | 'url'; secret?: boolean }[]
}

export const FEATURE_CATALOG: FeatureMeta[] = [
  {
    key: FEATURE_KEYS.PREMIUM_CHECKOUT,
    label: 'Checkout Premium',
    description: 'Muestra el botÃ³n de suscripciÃ³n a Premium y procesa pagos.',
    category: 'monetization',
    configSchema: [],
  },
  {
    key: FEATURE_KEYS.STATIONS_CHECKOUT,
    label: 'Checkout Estaciones (add-on)',
    description: 'Muestra el botÃ³n de suscripciÃ³n al add-on Estaciones.',
    category: 'monetization',
  },
  {
    key: FEATURE_KEYS.AFFILIATES,
    label: 'Afiliados (general)',
    description: 'Activa las secciones patrocinadas en la app.',
    category: 'monetization',
  },
  {
    key: FEATURE_KEYS.AFFILIATES_AMAZON,
    label: 'Afiliados Amazon Associates',
    description: 'Usa Amazon como proveedor de productos afiliados.',
    category: 'monetization',
    configSchema: [
      { key: 'tracking_id', label: 'Amazon Tracking ID', type: 'string' },
      { key: 'marketplace', label: 'Marketplace (amazon.es, amazon.comâ€¦)', type: 'string' },
    ],
  },
  {
    key: FEATURE_KEYS.ADS_ADSENSE,
    label: 'Google AdSense',
    description: 'Muestra bloques de AdSense en los slots definidos.',
    category: 'monetization',
    configSchema: [
      { key: 'client_id', label: 'AdSense Client ID (ca-pub-â€¦)', type: 'string' },
      { key: 'slot_sidebar', label: 'Ad Slot ID (sidebar)', type: 'string' },
      { key: 'slot_feed', label: 'Ad Slot ID (in-feed)', type: 'string' },
    ],
  },
  {
    key: FEATURE_KEYS.ADS_ETHICALADS,
    label: 'EthicalAds',
    description: 'Muestra bloques de EthicalAds (alternativa Ã©tica a AdSense).',
    category: 'monetization',
    configSchema: [
      { key: 'publisher_id', label: 'Publisher ID', type: 'string' },
      { key: 'placement', label: 'Placement', type: 'string' },
    ],
  },
  {
    key: FEATURE_KEYS.COOKIEBOT,
    label: 'Cookiebot (CMP)',
    description: 'Banner de consentimiento RGPD. Necesario para mostrar ads.',
    category: 'infrastructure',
    configSchema: [
      { key: 'cbid', label: 'Cookiebot ID', type: 'string' },
    ],
  },
  {
    key: FEATURE_KEYS.PLAUSIBLE,
    label: 'Plausible Analytics',
    description: 'Analytics RGPD-friendly.',
    category: 'analytics',
    configSchema: [
      { key: 'domain', label: 'Plausible domain', type: 'string' },
    ],
  },
  {
    key: FEATURE_KEYS.NEWSLETTER,
    label: 'Newsletter',
    description: 'Permite suscribirse al resumen semanal.',
    category: 'monetization',
  },
  {
    key: FEATURE_KEYS.PUSH,
    label: 'Push notifications',
    description: 'Permite activar alertas push (Web Push).',
    category: 'monetization',
    configSchema: [
      { key: 'vapid_public_key', label: 'VAPID Public Key', type: 'string' },
      { key: 'vapid_private_key', label: 'VAPID Private Key', type: 'string', secret: true },
      { key: 'vapid_subject', label: 'VAPID Subject (mailto:â€¦)', type: 'string' },
    ],
  },
  {
    key: FEATURE_KEYS.KOFI,
    label: 'Ko-fi (donaciones)',
    description: 'Muestra el botÃ³n de donaciÃ³n Ko-fi en el footer.',
    category: 'monetization',
    configSchema: [
      { key: 'url', label: 'URL de tu pÃ¡gina Ko-fi', type: 'url' },
    ],
  },
  {
    key: FEATURE_KEYS.GITHUB_SPONSORS,
    label: 'GitHub Sponsors',
    description: 'Muestra el botÃ³n de GitHub Sponsors.',
    category: 'monetization',
    configSchema: [
      { key: 'url', label: 'URL de tu GitHub Sponsors', type: 'url' },
    ],
  },
  {
    key: FEATURE_KEYS.STRIPE,
    label: 'Stripe (pagos)',
    description: 'Procesa pagos a travÃ©s de Stripe. Activar antes que Premium/Estaciones checkout.',
    category: 'infrastructure',
    configSchema: [
      { key: 'secret_key', label: 'Stripe Secret Key', type: 'string', secret: true },
      { key: 'webhook_secret', label: 'Webhook Signing Secret', type: 'string', secret: true },
      { key: 'publishable_key', label: 'Publishable Key', type: 'string' },
    ],
  },
  {
    key: FEATURE_KEYS.RESEND,
    label: 'Resend (emails)',
    description: 'EnvÃ­a emails transaccionales (magic link admin, receipts, etc.).',
    category: 'infrastructure',
    configSchema: [
      { key: 'api_key', label: 'Resend API Key', type: 'string', secret: true },
      { key: 'from_email', label: 'Email From (Weather <hola@â€¦>)', type: 'string' },
    ],
  },
  {
    key: FEATURE_KEYS.BUTTONDOWN,
    label: 'Buttondown (newsletter)',
    description: 'Gestiona el envÃ­o de la newsletter.',
    category: 'infrastructure',
    configSchema: [
      { key: 'api_key', label: 'Buttondown API Key', type: 'string', secret: true },
    ],
  },
  {
    key: FEATURE_KEYS.METRICS_DASHBOARD,
    label: 'Dashboard de mÃ©tricas',
    description: 'PÃ¡ginas /admin/metrics (trÃ¡fico, cohorts, funnels).',
    category: 'analytics',
  },
  {
    key: FEATURE_KEYS.FEATURE_FLAGS_ADMIN,
    label: 'PÃ¡gina de feature flags',
    description: 'Muestra /admin/features. Normalmente siempre ON.',
    category: 'infrastructure',
  },
  {
    key: FEATURE_KEYS.ANOMALY_ALERTS,
    label: 'Alertas de anomalÃ­as',
    description: 'Cron diario que detecta caÃ­das de trÃ¡fico / conversiones y avisa por email.',
    category: 'analytics',
  },
]

/** Read all flags in a single query for the admin overview. */
export async function listAllFeatures(): Promise<
  { key: string; enabled: boolean; config: Record<string, unknown>; description: string | null; updatedAt: number | null }[]
> {
  try {
    const rows = await db.select<{
      key: string
      enabled: number | string
      config: string | null
      description: string | null
      updated_at: number | null
    }>(
      'SELECT key, enabled, config, description, updated_at FROM feature_flags ORDER BY key',
    )
    return rows.map(r => ({
      key: r.key,
      enabled: Number(r.enabled) === 1,
      config: r.config ? JSON.parse(r.config) : {},
      description: r.description,
      updatedAt: r.updated_at != null ? Number(r.updated_at) : null,
    }))
  } catch {
    return []
  }
}

let schemaReady: Promise<boolean> | null = null

/** Ensure the `feature_flags` table exists and is seeded with the
 *  catalogue. Called from each feature lookup so the very first request
 *  after a fresh deploy bootstraps the schema without needing a manual
 *  migration step. */
export async function ensureFeatureFlagsSchema(): Promise<boolean> {
  if (schemaReady) return schemaReady
  schemaReady = db.ensure().then(async ok => {
    if (!ok) return false
    try {
      await db.execute(
        `CREATE TABLE IF NOT EXISTS feature_flags (
          key TEXT PRIMARY KEY,
          enabled INTEGER NOT NULL DEFAULT 0,
          config TEXT,
          description TEXT,
          updated_at INTEGER,
          updated_by TEXT
        )`,
      )
      // Seed catalogue rows (idempotent â€” INSERT OR IGNORE keeps manual edits)
      for (const meta of FEATURE_CATALOG) {
        await db.execute(
          `INSERT OR IGNORE INTO feature_flags (key, enabled, description) VALUES (?, 0, ?)`,
          [meta.key, meta.description],
        )
      }
      return true
    } catch {
      return false
    }
  }).catch(() => { schemaReady = null; return false })
  return schemaReady
}
