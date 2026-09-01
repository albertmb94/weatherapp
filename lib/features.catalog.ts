/**
 * Catálogo de flags: SÓLO DATOS, sin tocar la base de datos.
 *
 * POR QUÉ ESTÁ SEPARADO DE `lib/features.ts`. Ese módulo importa
 * `./db` y, a través de él, `@libsql/client`. El panel de admin es
 * `'use client'` y sólo necesitaba esta constante, pero el import
 * arrastraba el cliente de base de datos entero al navegador: ~482 KB
 * de código que allí no puede ejecutarse.
 *
 * Regla para este fichero: no puede importar nada con efectos de
 * servidor. Si algo de aquí necesita la base de datos, va en
 * `features.ts`, no aquí.
 */

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

export interface FeatureMeta {
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
