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
    // `db.execute` (permisivo) devuelve false en vez de lanzar, así que
    // este catch era CÓDIGO MUERTO y un borrado fallido respondía
    // { ok: true }: el operador veía "borrado" y el producto seguía
    // sirviéndose en la portada. La variante estricta sí lanza.
    await db.executeOrThrow('DELETE FROM affiliate_products WHERE id = ?', [affiliateId])
    return NextResponse.json({ ok: true })
  } catch (err) {
    // Sin String(err): el mensaje crudo de libsql no va al cliente.
    console.error('[afiliados] borrado fallido de', affiliateId, err)
    return NextResponse.json({ ok: false, error: 'delete_failed' }, { status: 500 })
  }
}
