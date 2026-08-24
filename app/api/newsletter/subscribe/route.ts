import { NextRequest, NextResponse } from 'next/server'
import { ensureNewsletterSchema } from '@/lib/newsletter'
import { db } from '@/lib/db'
import { rateLimit } from '@/lib/rateLimit'

/**
 * B-NBT-17: public newsletter subscribe endpoint.
 * POST {email} → INSERT OR IGNORE into newsletter_subscribers.
 * Rate limited 3/min/IP. No auth needed.
 */
export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (!rateLimit(`newsletter:${ip}`, 3)) {
    return NextResponse.json({ ok: false, error: 'rate_limited' }, { status: 429 })
  }

  let email = ''
  try {
    const body = await req.json()
    email = String(body.email ?? '').toLowerCase().trim()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 })
  }
  if (!email || !email.includes('@')) {
    return NextResponse.json({ ok: false, error: 'invalid_email' }, { status: 400 })
  }

  await ensureNewsletterSchema()
  try {
    await db.execute(
      `INSERT INTO newsletter_subscribers (email, subscribed_at) VALUES (?, ?)
            ON CONFLICT(email) DO UPDATE SET unsubscribed_at = NULL`,
      [email, Date.now()],
    )
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[newsletter] subscribe failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ ok: false, error: 'db_error' }, { status: 503 })
  }
}
