import { NextRequest, NextResponse } from 'next/server'
import { getCurrentAdmin } from '@/lib/admin/auth'
import { db } from '@/lib/db'
import { safeDecode } from '@/lib/api/params'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ email: string }> }) {
  const admin = await getCurrentAdmin()
  if (!admin) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  const { email } = await params
  const decoded = safeDecode(email)
  if (decoded === null) {
    return NextResponse.json({ ok: false, error: 'malformed_email' }, { status: 400 })
  }
  const userEmail = decoded.toLowerCase()
  try {
    const subs = await db.select<{
      email: string
      kind: string
      status: string
      plan: string
      current_period_end: number
      stripe_subscription_id: string
      created_at: number
    }>(
      `SELECT email, kind, status, plan, current_period_end, stripe_subscription_id, created_at
       FROM subscriptions WHERE email = ? ORDER BY created_at DESC`,
      [userEmail],
    )
    const grants = await db.select<{
      id: string
      kind: string
      reason: string | null
      granted_by: string
      granted_at: number
      expires_at: number | null
      revoked_at: number | null
    }>(
      `SELECT id, kind, reason, granted_by, granted_at, expires_at, revoked_at
       FROM user_grants WHERE email = ? ORDER BY granted_at DESC`,
      [userEmail],
    )
    return NextResponse.json({
      ok: true,
      user: {
        email: userEmail,
        subscriptions: subs.map(s => ({
          kind: s.kind,
          status: s.status,
          plan: s.plan,
          currentPeriodEnd: Number(s.current_period_end),
          stripeSubscriptionId: s.stripe_subscription_id,
          createdAt: Number(s.created_at),
        })),
        grants: grants.map(g => ({
          id: g.id,
          kind: g.kind,
          reason: g.reason,
          grantedBy: g.granted_by,
          grantedAt: Number(g.granted_at),
          expiresAt: g.expires_at != null ? Number(g.expires_at) : null,
          revokedAt: g.revoked_at != null ? Number(g.revoked_at) : null,
        })),
      },
    })
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
