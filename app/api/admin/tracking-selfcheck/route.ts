import { NextRequest, NextResponse } from 'next/server'
import { getCurrentAdmin } from '@/lib/admin/auth'
import { db } from '@/lib/db'
import { isTrackingAllowed, normalizeConsentValue, CONSENT_COOKIE } from '@/lib/trackingConsent'
import { todayKey } from '@/lib/analytics/time'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ANON_COOKIE = 'wthr_anon'
const SESSION_COOKIE = 'wthr_session'

/**
 * ¿Por qué no aparecen MIS visitas en el panel?
 *
 * POR QUÉ EXISTE ESTA RUTA
 *
 * El sistema de analítica está lleno de razones LEGÍTIMAS para no contar
 * a alguien: no ha aceptado el banner, un bloqueador le corta la petición,
 * su navegador arrastra una versión antigua en caché. Todas correctas, y
 * todas indistinguibles desde el panel de un fallo de verdad.
 *
 * Eso convirtió "no se registran mis visitas" en varias investigaciones
 * largas en las que había que ir descartando causas a ciegas, cuando el
 * servidor tenía la respuesta delante: sabe qué cookies trae ESTA
 * petición. Basta con preguntárselo desde el mismo navegador con el que
 * se navega.
 *
 * NO devuelve el anon_id, sólo si existe: el panel no necesita el
 * pseudónimo de nadie para responder a la pregunta.
 */
export async function GET(req: NextRequest) {
  const admin = await getCurrentAdmin()
  if (!admin) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  const consentBruto = req.cookies.get(CONSENT_COOKIE)?.value
  const consentimiento = normalizeConsentValue(consentBruto)
  const anonId = req.cookies.get(ANON_COOKIE)?.value ?? null
  const sesion = Boolean(req.cookies.get(SESSION_COOKIE)?.value)

  const navegador = {
    consentimiento,
    tieneIdentidad: Boolean(anonId),
    tieneSesion: sesion,
    // La única pregunta que importa: ¿se contaría una visita de ESTE
    // navegador ahora mismo?
    seRegistra: isTrackingAllowed(consentBruto),
  }

  const hoy = todayKey()
  let esteDispositivo: { vistasHoy: number; ultima: number | null } | null = null
  let sitio: { vistasHoy: number; dispositivosHoy: number; ultima: number | null } | null = null

  try {
    if (anonId) {
      const filas = await db.selectOrThrow<{ n: number; ultima: number | null }>(
        'SELECT COUNT(*) AS n, MAX(ts) AS ultima FROM page_views WHERE anon_id = ? AND day = ?',
        [anonId, hoy],
      )
      esteDispositivo = {
        vistasHoy: Number(filas[0]?.n ?? 0),
        ultima: filas[0]?.ultima == null ? null : Number(filas[0].ultima),
      }
    }

    const globales = await db.selectOrThrow<{ n: number; d: number; ultima: number | null }>(
      'SELECT COUNT(*) AS n, COUNT(DISTINCT anon_id) AS d, MAX(ts) AS ultima FROM page_views WHERE day = ?',
      [hoy],
    )
    sitio = {
      vistasHoy: Number(globales[0]?.n ?? 0),
      dispositivosHoy: Number(globales[0]?.d ?? 0),
      ultima: globales[0]?.ultima == null ? null : Number(globales[0].ultima),
    }
  } catch (err) {
    console.error('[selfcheck] no se pudo leer la actividad:', err)
    return NextResponse.json({ ok: false, error: 'query_failed' }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    navegador,
    esteDispositivo,
    sitio,
    // Sin este secreto, el proxy no registra la sesión de quien tiene el
    // JS bloqueado. No afecta al camino normal (el beacon del navegador),
    // pero explica por qué faltan visitas sin JavaScript.
    bootstrapProxy: Boolean(process.env.TRACK_INTERNAL_SECRET),
  })
}
