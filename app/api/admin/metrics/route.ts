import { NextRequest, NextResponse } from 'next/server'
import { getCurrentAdmin } from '@/lib/admin/auth'
import { getAdminMetrics, parseRange } from '@/lib/analytics'

/** Payload del panel en JSON. El server component lee lib/analytics
 *  directamente (no merece la pena un self-fetch más otra validación de
 *  sesión contra la BD); esta ruta existe para tooling externo.
 *
 *  Auditoría: antes fijaba 30 días a fuego e ignoraba cualquier
 *  parámetro, pese a que `rangeDays` ya existía en el tipo. Y sólo sabía
 *  devolver 503 "db_unavailable" para cualquier fallo — que además nunca
 *  se daba, porque `db.select` se tragaba los errores. */
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const admin = await getCurrentAdmin()
  if (!admin) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const rangeDays = parseRange(new URL(req.url).searchParams.get('range'))
  const result = await getAdminMetrics(rangeDays)

  if (!result.ok) {
    // 500 sólo cuando la consulta falla de verdad; "no configurada" y
    // "migraciones pendientes" son problemas de despliegue, no del
    // servicio, y merecen 503.
    const status = result.error === 'query_failed' ? 500 : 503
    return NextResponse.json({ ok: false, error: result.error, detail: result.detail }, { status })
  }
  return NextResponse.json({ ok: true, metrics: result.metrics })
}
