/**
 * Feature flags — single source of truth for which monetisation features
 * are currently active. Every feature reads through `getFeature()` so
 * the admin panel can toggle each one without a redeploy.
 *
 * Defaults to OFF for every flag. The `seed` row in the migration
 * pre-populates the catalogue so the admin UI can render a list even
 * before anyone has clicked a toggle.
 */

import { cache } from 'react'
import { db } from './db'
import { memoizeSchema } from './schemaGuard'

export interface FeatureFlag {
  enabled: boolean
  config: Record<string, unknown>
  description?: string
}

/** Cache the lookup within a single request so multiple consumers in the
 *  same render don't hit the DB repeatedly.
 *
 *  B-NBT-9c (2026-08-22): `revalidateFeature()` used to write into a
 *  module-level Map that getFeature() merely "touched" — reading a Map
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
  // Auditoría S4: sin esto, en una BD sin `feature_flags` toda flag leía
  // `false` en silencio (db.select traga el "no such table") y el sitio
  // se comportaba como si el operador lo hubiera apagado todo.
  if (!(await ensureFeatureFlagsSchema())) return { enabled: false, config: {} }
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
 *  Admin toggles take effect on the next request automatically — there
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
    description: 'Muestra el botón de suscripción a Premium y procesa pagos.',
    category: 'monetization',
    configSchema: [],
  },
  {
    key: FEATURE_KEYS.STATIONS_CHECKOUT,
    label: 'Checkout Estaciones (add-on)',
    description: 'Muestra el botón de suscripción al add-on Estaciones.',
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
      { key: 'marketplace', label: 'Marketplace (amazon.es, amazon.com…)', type: 'string' },
    ],
  },
  {
    key: FEATURE_KEYS.ADS_ADSENSE,
    label: 'Google AdSense',
    description: 'Muestra bloques de AdSense en los slots definidos.',
    category: 'monetization',
    configSchema: [
      { key: 'client_id', label: 'AdSense Client ID (ca-pub-…)', type: 'string' },
      { key: 'slot_sidebar', label: 'Ad Slot ID (sidebar)', type: 'string' },
      { key: 'slot_feed', label: 'Ad Slot ID (in-feed)', type: 'string' },
    ],
  },
  {
    key: FEATURE_KEYS.ADS_ETHICALADS,
    label: 'EthicalAds',
    description: 'Muestra bloques de EthicalAds (alternativa ética a AdSense).',
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
      { key: 'vapid_subject', label: 'VAPID Subject (mailto:…)', type: 'string' },
    ],
  },
  {
    key: FEATURE_KEYS.KOFI,
    label: 'Ko-fi (donaciones)',
    description: 'Muestra el botón de donación Ko-fi en el footer.',
    category: 'monetization',
    configSchema: [
      { key: 'url', label: 'URL de tu página Ko-fi', type: 'url' },
    ],
  },
  {
    key: FEATURE_KEYS.GITHUB_SPONSORS,
    label: 'GitHub Sponsors',
    description: 'Muestra el botón de GitHub Sponsors.',
    category: 'monetization',
    configSchema: [
      { key: 'url', label: 'URL de tu GitHub Sponsors', type: 'url' },
    ],
  },
  {
    key: FEATURE_KEYS.STRIPE,
    label: 'Stripe (pagos)',
    description: 'Procesa pagos a través de Stripe. Activar antes que Premium/Estaciones checkout.',
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
    description: 'Envía emails transaccionales (magic link admin, receipts, etc.).',
    category: 'infrastructure',
    configSchema: [
      { key: 'api_key', label: 'Resend API Key', type: 'string', secret: true },
      { key: 'from_email', label: 'Email From (Weather <hola@…>)', type: 'string' },
    ],
  },
  {
    key: FEATURE_KEYS.BUTTONDOWN,
    label: 'Buttondown (newsletter)',
    description: 'Gestiona el envío de la newsletter.',
    category: 'infrastructure',
    configSchema: [
      { key: 'api_key', label: 'Buttondown API Key', type: 'string', secret: true },
    ],
  },
  {
    key: FEATURE_KEYS.METRICS_DASHBOARD,
    label: 'Dashboard de métricas',
    description: 'Páginas /admin/metrics (tráfico, cohorts, funnels).',
    category: 'analytics',
  },
  {
    key: FEATURE_KEYS.FEATURE_FLAGS_ADMIN,
    label: 'Página de feature flags',
    description: 'Muestra /admin/features. Normalmente siempre ON.',
    category: 'infrastructure',
  },
  {
    key: FEATURE_KEYS.ANOMALY_ALERTS,
    label: 'Alertas de anomalías',
    description: 'Cron diario que detecta caídas de tráfico / conversiones y avisa por email.',
    category: 'analytics',
  },
]

/** Read all flags in a single query for the admin overview.
 *  B-NBT-18: los valores de campos secretos se devuelven como ''
 *  para que el formulario no los muestre y el PUT no los
 *  sobrescriba accidentalmente con vacío. */
/** Claves de config cuyo valor nunca debe salir por una API. Cubre
 *  secret_key, api_key, token, password, private_key… (auditoría: la
 *  regex anterior dejaba pasar `api_key` en claro). */
const SECRET_KEY_RE = /secret|password|private|api_?key|token|credential/i

export function maskSecretConfig(cfg: Record<string, unknown>): Record<string, unknown> {
  for (const k of Object.keys(cfg)) {
    if (SECRET_KEY_RE.test(k)) cfg[k] = ''
  }
  return cfg
}

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
    return rows.map(r => {
      const cfg: Record<string, unknown> = r.config ? JSON.parse(r.config) : {}
      // Ocultar valores de claves secretas
      return {
        key: r.key,
        enabled: Number(r.enabled) === 1,
        config: maskSecretConfig(cfg),
        description: r.description,
        updatedAt: r.updated_at != null ? Number(r.updated_at) : null,
      }
    })
  } catch {
    return []
  }
}

/** Ensure the `feature_flags` table exists and is seeded with the
 *  catalogue. Se invoca desde CADA lectura de flag (`loadFeature`), de
 *  modo que la primera petición tras un despliegue nuevo arranca el
 *  esquema sin paso manual de migración.
 *
 *  Auditoría S4: el docstring ya prometía esto, pero el único llamador
 *  real era el PUT del admin. En una BD nueva `feature_flags` no
 *  existía, `db.select` tragaba el "no such table" devolviendo `[]` y
 *  TODA flag leía `false` — con lo que el webhook de Stripe descartaba
 *  pagos reales y los emails transaccionales se registraban como
 *  "skipped", hasta que alguien abría /admin/features y pulsaba
 *  guardar. */
export const ensureFeatureFlagsSchema = memoizeSchema('features', async () => {
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
  // Seed catalogue rows (idempotent — INSERT OR IGNORE keeps manual edits)
  for (const meta of FEATURE_CATALOG) {
    await db.execute(
      `INSERT OR IGNORE INTO feature_flags (key, enabled, description) VALUES (?, 0, ?)`,
      [meta.key, meta.description],
    )
  }
})
