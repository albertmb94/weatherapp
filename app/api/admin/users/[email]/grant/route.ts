import { NextRequest, NextResponse } from 'next/server'
import { getCurrentAdmin } from '@/lib/admin/auth'
import { db } from '@/lib/db'
import { randomBytes } from 'crypto'
import { safeDecode } from '@/lib/api/params'

interface GrantPayload {
  kind: 'premium' | 'stations'
  expiresAt?: number | null
  reason?: string
  plan?: 'monthly' | 'yearly'
}

/** Grant a manual subscription (no Stripe required). The entitlement
 *  token is created/linked so the user can claim it via /premium/claim
 *  with their email. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ email: string }> }) {
  const admin = await getCurrentAdmin()
  if (!admin) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  const { email } = await params
  const decodedPost = safeDecode(email)
  if (decodedPost === null) {
    return NextResponse.json({ ok: false, error: 'malformed_email' }, { status: 400 })
  }
  const userEmail = decodedPost.toLowerCase()
  let body: GrantPayload
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 })
  }
  if (body.kind !== 'premium' && body.kind !== 'stations') {
    return NextResponse.json({ ok: false, error: 'invalid_kind' }, { status: 400 })
  }
  const grantId = randomBytes(10).toString('hex')
  const now = Date.now()
  const subId = `manual_${grantId}`
  const token = randomBytes(20).toString('hex')
  const periodEnd = body.expiresAt ?? now + 365 * 24 * 60 * 60 * 1000 // default 1y

  try {
    await db.execute(
      `INSERT INTO subscriptions (email, kind, stripe_customer_id, stripe_subscription_id, status, plan, current_period_end, entitlement_token, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`,
      [userEmail, body.kind, null, subId, body.plan ?? 'yearly', periodEnd, token, now, now],
    )
    await db.execute(
      `INSERT INTO user_grants (id, email, kind, reason, granted_by, granted_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [grantId, userEmail, body.kind, body.reason ?? null, admin, now, body.expiresAt ?? null],
    )
    return NextResponse.json({ ok: true, token, periodEnd })
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ email: string }> }) {
  const admin = await getCurrentAdmin()
  if (!admin) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  const { email } = await params
  const decodedDelete = safeDecode(email)
  if (decodedDelete === null) {
    return NextResponse.json({ ok: false, error: 'malformed_email' }, { status: 400 })
  }
  const userEmail = decodedDelete.toLowerCase()
  const kind = req.nextUrl.searchParams.get('kind') ?? ''
  if (kind !== 'premium' && kind !== 'stations') {
    return NextResponse.json({ ok: false, error: 'invalid_kind' }, { status: 400 })
  }
  try {
    await db.execute(
      `UPDATE subscriptions SET status = 'canceled', updated_at = ? WHERE email = ? AND kind = ?`,
      [Date.now(), userEmail, kind],
    )
    await db.execute(
      `UPDATE user_grants SET revoked_at = ? WHERE email = ? AND kind = ? AND revoked_at IS NULL`,
      [Date.now(), userEmail, kind],
    )
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
