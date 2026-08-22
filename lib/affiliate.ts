/**
 * Affiliate system — sponsored product blocks contextualised by the
 * current forecast. Disabled by default; the admin flips
 * `feature.affiliates` (and `feature.affiliates.amazon`) on once the
 * Amazon Associates account is approved and the tracking ID is pasted
 * in the feature config.
 */

import { db } from './db'
import { getFeature } from './features'

export type AffiliateTrigger =
  | 'uv_high'
  | 'rain_24h'
  | 'pollen_high'
  | 'wind_strong'
  | 'frost'
  | 'heat'
  | 'snow'
  | 'fog'

let schemaReady: Promise<boolean> | null = null

export async function ensureAffiliateSchema(): Promise<boolean> {
  if (schemaReady) return schemaReady
  schemaReady = db.ensure().then(ok => {
    if (!ok) return false
    return db.execute(
      `CREATE TABLE IF NOT EXISTS affiliate_products (
        id TEXT PRIMARY KEY,
        trigger TEXT NOT NULL,
        asin TEXT NOT NULL,
        locale TEXT NOT NULL,
        title TEXT NOT NULL,
        price_label TEXT,
        image_url TEXT,
        affiliate_url TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER
      )`,
    ).then(() => db.execute(
      'CREATE INDEX IF NOT EXISTS idx_aff_products_trigger ON affiliate_products(trigger, locale, enabled)',
    )).then(() => db.execute(
      `CREATE TABLE IF NOT EXISTS affiliate_clicks (
        id TEXT PRIMARY KEY,
        anon_id TEXT NOT NULL,
        program TEXT NOT NULL,
        product_id TEXT NOT NULL,
        trigger TEXT NOT NULL,
        city TEXT,
        ts INTEGER NOT NULL
      )`,
    )).then(() => db.execute(
      'CREATE INDEX IF NOT EXISTS idx_affiliate_clicks_ts ON affiliate_clicks(ts)',
    )).then(() => true)
      .catch(() => false)
  }).catch(() => false)
  return schemaReady
}

export interface AffiliateProduct {
  id: string
  trigger: string
  asin: string
  locale: 'es' | 'en'
  title: string
  priceLabel: string | null
  imageUrl: string | null
  affiliateUrl: string
  enabled: boolean
  sortOrder: number
}

interface AffiliateRow {
  id: string
  trigger: string
  asin: string
  locale: string
  title: string
  price_label: string | null
  image_url: string | null
  affiliate_url: string
  enabled: number | string
  sort_order: number | string
}

export async function listAffiliateProducts(opts: {
  trigger?: string
  locale?: 'es' | 'en'
  enabledOnly?: boolean
} = {}): Promise<AffiliateProduct[]> {
  await ensureAffiliateSchema()
  const where: string[] = []
  const args: (string | number)[] = []
  if (opts.trigger) {
    where.push('trigger = ?')
    args.push(opts.trigger)
  }
  if (opts.locale) {
    where.push('locale = ?')
    args.push(opts.locale)
  }
  if (opts.enabledOnly !== false) {
    where.push('enabled = 1')
  }
  try {
    const rows = await db.select<AffiliateRow>(
      `SELECT id, trigger, asin, locale, title, price_label, image_url, affiliate_url, enabled, sort_order
       FROM affiliate_products
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY sort_order ASC, id ASC`,
      args,
    )
    return rows.map(r => ({
      id: r.id,
      trigger: r.trigger,
      asin: r.asin,
      locale: r.locale as 'es' | 'en',
      title: r.title,
      priceLabel: r.price_label,
      imageUrl: r.image_url,
      affiliateUrl: r.affiliate_url,
      enabled: Number(r.enabled) === 1,
      sortOrder: Number(r.sort_order),
    }))
  } catch {
    return []
  }
}

/** Return the most relevant products for the current triggers and
 *  locale. Used by the home-content SponsoredSection. */
export async function pickProducts(opts: {
  triggers: AffiliateTrigger[]
  locale: 'es' | 'en'
  limit?: number
}): Promise<AffiliateProduct[]> {
  if (opts.triggers.length === 0) return []
  // Pull up to `limit` per trigger and merge in priority order.
  const limit = opts.limit ?? 4
  const out: AffiliateProduct[] = []
  for (const trigger of opts.triggers) {
    const items = await listAffiliateProducts({ trigger, locale: opts.locale })
    for (const item of items) {
      if (out.find(p => p.id === item.id)) continue
      out.push(item)
      if (out.length >= limit) return out
    }
  }
  return out
}

export interface AffiliateConfig {
  trackingId: string
  marketplace: string
}

export async function getAmazonAffiliateConfig(): Promise<AffiliateConfig | null> {
  const flag = await getFeature('feature.affiliates.amazon')
  if (!flag.enabled) return null
  const trackingId = String(flag.config.tracking_id ?? '').trim()
  const marketplace = String(flag.config.marketplace ?? 'amazon.es').trim()
  if (!trackingId) return null
  return { trackingId, marketplace }
}

/** Build the outbound Amazon URL with the configured tracking ID.
 *  Accepts either a raw URL (already containing a tag) or an ASIN. */
export function buildAffiliateUrl(input: string | { asin: string; marketplace: string }, cfg: AffiliateConfig): string {
  if (typeof input === 'object') {
    const { asin, marketplace } = input
    return `https://www.${marketplace}/dp/${asin}?tag=${encodeURIComponent(cfg.trackingId)}`
  }
  // If URL already contains `?tag=`, replace it; otherwise append.
  try {
    const u = new URL(input)
    u.searchParams.set('tag', cfg.trackingId)
    return u.toString()
  } catch {
    const sep = input.includes('?') ? '&' : '?'
    return `${input}${sep}tag=${encodeURIComponent(cfg.trackingId)}`
  }
}
