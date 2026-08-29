import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { migrationsReady } from '@/lib/migrations'
import { dayKey } from '@/lib/analytics/time'
import { rateLimit } from '@/lib/rateLimit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Contador agregado de impresiones y respuestas del banner de consentimiento.
 *
 * POR QUÉ ESTA RUTA NO SE PARECE A /api/ingest
 *
 * Medir la tasa de aceptación obliga a contar a gente que TODAVÍA NO HA
 * CONSENTIDO. Eso hace inviable el modelo de la ingesta —cookie de
 * identidad, sesión, dedupe por dispositivo— porque montarlo aquí sería
 * exactamente el seguimiento sin permiso que el banner viene a evitar.
 *
 * Así que aquí NO se lee ni se escribe ninguna cookie, no hay anon_id, no
 * hay sesión y no se guarda la IP. Sólo se incrementa un contador por día
 * y tipo de evento. Sin almacenar ni leer nada en el dispositivo y sin
 * identificador, no hay dato personal que consentir.
 *
 * La IP se usa SÓLO en memoria para el rate limit, que es lo que impide
 * que cualquiera infle la métrica desde fuera. No se persiste.
 *
 * `shown` cuenta IMPRESIONES, no personas: el banner reaparece en cada
 * carga hasta que se responde. El panel etiqueta la tasa como
 * "por impresión" por ese motivo.
 */

const EVENTOS = new Set(['shown', 'accept', 'reject'])

export async function POST(req: NextRequest) {
  const migraciones = await migrationsReady()
  if (!migraciones.ok) {
    // 204: no es culpa del cliente y no hay nada que pueda hacer. Un
    // error aquí no debe ensuciar la consola de nadie ni reintentarse.
    return new NextResponse(null, { status: 204 })
  }

  // Sólo para acotar el abuso, y sólo en memoria.
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'desconocida'
  if (!rateLimit(`consent-stats:${ip}`, 30)) {
    return new NextResponse(null, { status: 204 })
  }

  let evento: unknown
  try {
    const cuerpo = (await req.json()) as { e?: unknown }
    evento = cuerpo?.e
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 })
  }

  if (typeof evento !== 'string' || !EVENTOS.has(evento)) {
    return NextResponse.json({ ok: false, error: 'evento_invalido' }, { status: 400 })
  }

  try {
    await db.executeOrThrow(
      `INSERT INTO consent_stats (day, event, count) VALUES (?, ?, 1)
       ON CONFLICT(day, event) DO UPDATE SET count = count + 1`,
      [dayKey(Date.now()), evento],
    )
  } catch (err) {
    console.error('[consent-stats] escritura fallida:', err instanceof Error ? err.message : err)
    return new NextResponse(null, { status: 204 })
  }

  // 204 sin cuerpo y SIN Set-Cookie: la respuesta no puede devolver
  // estado al dispositivo, o dejaría de ser anónima.
  return new NextResponse(null, { status: 204 })
}
