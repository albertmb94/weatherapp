import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { getCurrentAdmin } from '@/lib/admin/auth'
import { listAffiliateProducts, ensureAffiliateSchema } from '@/lib/affiliate'

export async function GET(_req: NextRequest) {
  const admin = await getCurrentAdmin()
  if (!admin) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  await ensureAffiliateSchema()
  const products = await listAffiliateProducts({ enabledOnly: false })
  return NextResponse.json({ ok: true, products })
}

interface CreatePayload {
  trigger: string
  locale: 'es' | 'en'
  asin: string
  title: string
  priceLabel?: string
  imageUrl?: string
}

export async function POST(req: NextRequest) {
  const admin = await getCurrentAdmin()
  if (!admin) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  let body: CreatePayload
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 })
  }
  if (!body.trigger || !body.locale || !body.asin || !body.title) {
    return NextResponse.json({ ok: false, error: 'missing_fields' }, { status: 400 })
  }
  await ensureAffiliateSchema()
  const id = randomBytes(8).toString('hex')
  const now = Date.now()
  const affiliateUrl = `https://www.amazon.es/dp/${body.asin}`
  try {
    const { db } = await import('@/lib/db')
    await db.execute(
      `INSERT INTO affiliate_products (id, trigger, asin, locale, title, price_label, image_url, affiliate_url, enabled, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?)`,
      [id, body.trigger, body.asin, body.locale, body.title, body.priceLabel ?? null, body.imageUrl ?? null, affiliateUrl, now],
    )
    return NextResponse.json({ ok: true, id })
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
