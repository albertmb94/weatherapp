import { NextRequest, NextResponse } from 'next/server'
import { getCurrentAdmin } from '@/lib/admin/auth'
import {
  listAffiliateProducts,
  ensureAffiliateSchema,
  upsertAffiliateProduct,
  extractAsinFromAmazonUrl,
} from '@/lib/affiliate'

export async function GET(_req: NextRequest) {
  const admin = await getCurrentAdmin()
  if (!admin) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  await ensureAffiliateSchema()
  const products = await listAffiliateProducts({ enabledOnly: false })
  return NextResponse.json({ ok: true, products })
}

interface CreatePayload {
  trigger?: string
  locale?: 'es' | 'en'
  /** ASIN de 10 caracteres, o una URL completa de producto de Amazon
   *  (/dp/ASIN) — el ASIN se extrae automáticamente. */
  asin?: string
  amazonUrl?: string
  title?: string
  description?: string
  priceLabel?: string
  imageUrl?: string
  enabled?: boolean
}

/** B-NBT-13: acepta `asin` directo O `amazonUrl` completa (extrae el
 *  ASIN), y construye el enlace final con el tracking ID configurado en
 *  feature.affiliates.amazon cuando existe. */
export async function POST(req: NextRequest) {
  const admin = await getCurrentAdmin()
  if (!admin) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  let body: CreatePayload
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 })
  }

  // Resolver ASIN: del campo directo o extrayéndolo de la URL completa.
  let asin = (body.asin ?? '').trim().toUpperCase()
  if (!asin && body.amazonUrl) {
    asin = extractAsinFromAmazonUrl(body.amazonUrl) ?? ''
    if (!asin) {
      return NextResponse.json(
        { ok: false, error: 'invalid_amazon_url', message: 'La URL no contiene un /dp/ASIN válido.' },
        { status: 400 },
      )
    }
  }
  if (!body.trigger || !body.locale || !asin || !body.title) {
    return NextResponse.json({ ok: false, error: 'missing_fields' }, { status: 400 })
  }

  await ensureAffiliateSchema()

  // Construir el enlace con tag de afiliado si hay tracking config; si
  // no, enlace limpio (mejor que rechazar: el admin puede añadir el
  // tracking_id después y re-guardar).
  let affiliateUrl = `https://www.amazon.es/dp/${asin}`
  try {
    const { getAmazonAffiliateConfig, buildAffiliateUrl } = await import('@/lib/affiliate')
    const cfg = await getAmazonAffiliateConfig()
    if (cfg) affiliateUrl = buildAffiliateUrl(asin, cfg)
  } catch { /* fallback a URL limpia */ }

  const id = await upsertAffiliateProduct({
    trigger: body.trigger,
    locale: body.locale,
    asin,
    title: body.title,
    description: body.description ?? null,
    priceLabel: body.priceLabel ?? null,
    imageUrl: body.imageUrl ?? null,
    affiliateUrl,
    enabled: body.enabled ?? true,
  })
  return NextResponse.json({ ok: true, id, affiliateUrl })
}
