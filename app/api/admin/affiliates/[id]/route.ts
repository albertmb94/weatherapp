import { NextRequest, NextResponse } from 'next/server'
import { getCurrentAdmin } from '@/lib/admin/auth'
import { db } from '@/lib/db'
import { safeDecode } from '@/lib/api/params'

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentAdmin()
  if (!admin) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  const { id } = await params
  const affiliateId = safeDecode(id)
  if (affiliateId === null) {
    return NextResponse.json({ ok: false, error: 'malformed_id' }, { status: 400 })
  }
  try {
    await db.execute('DELETE FROM affiliate_products WHERE id = ?', [affiliateId])
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
