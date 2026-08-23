import { NextRequest, NextResponse } from 'next/server'
import { getCurrentAdmin } from '@/lib/admin/auth'
import { ensureAffiliateSchema } from '@/lib/affiliate'
import { db } from '@/lib/db'

/** B-NBT-13: toggle enabled de un producto sin reenviar todo el objeto. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentAdmin()
  if (!admin) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  const { id } = await params
  let body: { enabled?: boolean }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 })
  }
  if (typeof body.enabled !== 'boolean') {
    return NextResponse.json({ ok: false, error: 'missing_enabled' }, { status: 400 })
  }
  await ensureAffiliateSchema()
  const ok = await db.execute(
    'UPDATE affiliate_products SET enabled = ?, updated_at = ? WHERE id = ?',
    [body.enabled ? 1 : 0, Date.now(), id],
  )
  if (!ok) return NextResponse.json({ ok: false, error: 'db_unavailable' }, { status: 503 })
  return NextResponse.json({ ok: true })
}
