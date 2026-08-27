import { NextRequest, NextResponse } from 'next/server'
import { getCurrentAdmin } from '@/lib/admin/auth'
import { db } from '@/lib/db'

/** User search for the admin panel. Looks up emails in the
 *  `subscriptions`, `newsletter_subscribers` (when added) and
 *  `user_grants` tables and aggregates the latest signal per email. */
export async function GET(req: NextRequest) {
  const admin = await getCurrentAdmin()
  if (!admin) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  const query = (req.nextUrl.searchParams.get('q') ?? '').trim().toLowerCase()
  const filter = req.nextUrl.searchParams.get('filter') ?? 'all'

  try {
    const where: string[] = []
    const args: (string | number)[] = []
    if (query) {
      where.push('email LIKE ?')
      args.push(`%${query}%`)
    }
    if (filter === 'premium') where.push("kind = 'premium' AND status IN ('active','trialing')")
    if (filter === 'stations') where.push("kind = 'stations' AND status IN ('active','trialing')")
    if (filter === 'canceled') where.push("status IN ('canceled','past_due')")

    // We pull from subscriptions first then enrich with page_views for last_seen
    const sql = `SELECT email, kind, status, plan, current_period_end, stripe_subscription_id, created_at
                 FROM subscriptions
                 ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                 ORDER BY created_at DESC
                 LIMIT 200`
    const rows = await db.select<{
      email: string
      kind: string
      status: string
      plan: string
      current_period_end: number
      stripe_subscription_id: string
      created_at: number
    }>(sql, args)

    // Aggregate by email
    const map = new Map<string, {
      email: string
      kinds: Set<string>
      lastSeen: number | null
      country: string | null
      totalSubscriptions: number
      active: number
    }>()
    for (const r of rows) {
      const key = r.email
      const prev = map.get(key) ?? {
        email: key,
        kinds: new Set<string>(),
        lastSeen: null,
        country: null,
        totalSubscriptions: 0,
        active: 0,
      }
      prev.kinds.add(r.kind)
      prev.totalSubscriptions++
      if (r.status === 'active' || r.status === 'trialing') prev.active++
      map.set(key, prev)
    }

    // Enrich with last_seen from visitor_identity (B-NBT-10: the
    // anon_id ↔ email link is created at premium-claim time).
    const users = [...map.values()].slice(0, 50)
    if (users.length > 0) {
      try {
        const placeholders = users.map(() => '?').join(', ')
        const vi = await db.select<{ email: string; last_seen_at: number }>(
          `SELECT email, MAX(last_seen_at) AS last_seen_at
           FROM visitor_identity
           WHERE email IN (${placeholders})
           GROUP BY email`,
          users.map(u => u.email),
        )
        const byEmail = new Map<string, number>()
        for (const r of vi) {
          byEmail.set(r.email, Number(r.last_seen_at))
        }
        for (const u of users) {
          u.lastSeen = byEmail.get(u.email) ?? null
        }
      } catch {
        for (const u of users) u.lastSeen = null
      }
    }

    return NextResponse.json({
      ok: true,
      users: users.map(u => ({
        email: u.email,
        premium: u.kinds.has('premium'),
        stations: u.kinds.has('stations'),
        totalSubscriptions: u.totalSubscriptions,
        active: u.active,
        lastSeen: u.lastSeen,
      })),
      total: map.size,
    })
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
