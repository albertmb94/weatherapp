import { NextRequest, NextResponse } from 'next/server'
import { getCurrentAdmin } from '@/lib/admin/auth'
import { resolveZoneNames } from '@/lib/analytics'
import { celdaValida } from '@/lib/analytics/geoCell'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Tope por petición. La geocodificación inversa es una llamada a un
 *  tercero por celda; sin tope, abrir el panel con muchas zonas nuevas
 *  dispararía una ráfaga. El panel pinta 6, así que 12 sobra. */
const MAX_CELDAS = 12

/**
 * Nombra en el acto las zonas que el panel acaba de pintar sin nombre.
 *
 * POR QUÉ AQUÍ Y NO EN EL CAMINO DEL VISITANTE
 *
 * Nombrar una celda es una llamada a un servicio externo. La versión
 * original la hacía DENTRO del render del panel —hasta 5 fetch
 * secuenciales de 4 s, hasta 20 s de TTFB— y por eso se movió al cron
 * nocturno. El coste de aquello fue que una ciudad consultada hoy no
 * tenía nombre hasta mañana.
 *
 * Esta ruta recupera la inmediatez sin recuperar el problema: la llamada
 * externa ocurre DESPUÉS de que el panel se haya pintado, la dispara el
 * navegador de quien administra, y exige sesión de admin — así que no
 * hay ninguna llamada a terceros colgando de una ruta pública, ni un bot
 * paseando coordenadas puede provocarlas.
 *
 * `geo_names` es caché permanente: cada celda se resuelve UNA vez en su
 * vida. El volumen no depende del tráfico, sino del número de zonas
 * distintas que alguien llega a mirar.
 *
 * El cron nocturno SIGUE existiendo como red de seguridad: cubre las
 * celdas que nadie mira y los reintentos si el proveedor falla.
 */
export async function POST(req: NextRequest) {
  const admin = await getCurrentAdmin()
  if (!admin) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  let cuerpo: unknown
  try {
    cuerpo = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 })
  }

  const brutas = (cuerpo as { cells?: unknown })?.cells
  if (!Array.isArray(brutas)) {
    return NextResponse.json({ ok: false, error: 'cells_requerido' }, { status: 400 })
  }

  // Se filtra ANTES de llamar a nadie: una etiqueta del panel puede ser
  // un nombre ya resuelto ("Badalona · Cataluña") o "(desconocido)", y
  // eso no es una celda.
  const celdas = brutas
    .filter((c): c is string => typeof c === 'string')
    .map(c => celdaValida(c))
    .filter((c): c is string => c !== null)
    .slice(0, MAX_CELDAS)

  if (celdas.length === 0) return NextResponse.json({ ok: true, resueltas: {} })

  try {
    const resueltas = await resolveZoneNames(celdas)
    return NextResponse.json({ ok: true, resueltas })
  } catch (err) {
    console.error('[zonas] resolución bajo demanda fallida:', err)
    return NextResponse.json({ ok: false, error: 'resolve_failed' }, { status: 500 })
  }
}
