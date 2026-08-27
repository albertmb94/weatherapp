/**
 * Affiliate system â€” sponsored product blocks contextualised by the
 * current forecast. Disabled by default; the admin flips
 * `feature.affiliates` (and `feature.affiliates.amazon`) on once the
 * Amazon Associates account is approved and the tracking ID is pasted
 * in the feature config.
 */

import { randomBytes } from 'crypto'
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
      // B-NBT-13: columna de texto libre por producto (self-healing)
      'ALTER TABLE affiliate_products ADD COLUMN description TEXT',
    ).catch(() => {/* ya existe */})).then(() => db.execute(
      `CREATE TABLE IF NOT EXISTS affiliate_clicks (
        id TEXT PRIMARY KEY,
        anon_id TEXT NOT NULL,
        program TEXT NOT NULL,
        product_id TEXT NOT NULL,
        trigger TEXT NOT NULL,
        city TEXT,
        ts INTEGER NOT NULL
      )`,
    )    ).then(() => db.execute(
      'CREATE INDEX IF NOT EXISTS idx_affiliate_clicks_ts ON affiliate_clicks(ts)',
    )).then(async () => {
      // B-NBT-15: migrar triggers viejos a los nuevos slot keys.
      const renames: [string, string][] = [
        ['uv_high', 'slot_uv'],
        ['rain_24h', 'slot_rain'],
      ]
      for (const [oldK, newK] of renames) {
        await db.execute(
          'UPDATE affiliate_products SET trigger = ? WHERE trigger = ?',
          [newK, oldK],
        )
      }
      return true
    }).then(() => true)
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
  description: string | null
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
  description?: string | null
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
      `SELECT id, trigger, asin, locale, title, description, price_label, image_url, affiliate_url, enabled, sort_order
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
      description: r.description ?? null,
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

/** B-NBT-13: extrae el ASIN de una URL de producto de Amazon
 *  (formatos /dp/ASIN, /gp/product/ASIN). Null si no coincide. */
export function extractAsinFromAmazonUrl(url: string): string | null {
  const m = /(?:\/dp\/|\/gp\/product\/)([A-Z0-9]{10})/i.exec(url)
  return m ? m[1].toUpperCase() : null
}

export interface AffiliateProductUpsert {
  id?: string
  trigger: string
  locale: 'es' | 'en'
  asin: string
  title: string
  description?: string | null
  priceLabel?: string | null
  imageUrl?: string | null
  affiliateUrl: string
  enabled: boolean
}

/** B-NBT-13: create/update atómico del catálogo de afiliados. */
export async function upsertAffiliateProduct(p: AffiliateProductUpsert): Promise<string> {
  await ensureAffiliateSchema()
  const id = p.id ?? randomId()
  const now = Date.now()
  await db.execute(
    `INSERT INTO affiliate_products
       (id, trigger, asin, locale, title, description, price_label, image_url, affiliate_url, enabled, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       trigger = excluded.trigger,
       asin = excluded.asin,
       locale = excluded.locale,
       title = excluded.title,
       description = excluded.description,
       price_label = excluded.price_label,
       image_url = excluded.image_url,
       affiliate_url = excluded.affiliate_url,
       enabled = excluded.enabled,
       updated_at = excluded.updated_at`,
    [id, p.trigger, p.asin, p.locale, p.title, p.description ?? null, p.priceLabel ?? null,
     p.imageUrl ?? null, p.affiliateUrl, p.enabled ? 1 : 0, now, now],
  )
  return id
}

function randomId(): string {
  const bytes = randomBytes(8)
  let out = ''
  for (const b of bytes) out += b.toString(16).padStart(2, '0')
  return out
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
