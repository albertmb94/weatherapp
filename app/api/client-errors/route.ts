import { NextRequest, NextResponse } from 'next/server'
import { migrationsReady } from '@/lib/migrations'
import { rateLimit } from '@/lib/rateLimit'
import { normalizarError, registrarErrorCliente } from '@/lib/clientErrors'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Recogida de errores de JavaScript que rompen la interfaz.
 *
 * POR QUÉ NO ES /api/ingest. La ingesta de analítica exige
 * consentimiento, cookie de identidad y sesión. Un error puede ocurrirle
 * a alguien que no ha consentido —de hecho el muro de consentimiento es
 * lo primero que se pinta, así que es donde MÁS probable es—, y no tiene
 * sentido que sólo veamos los fallos de quien acepta cookies. Así que
 * aquí no se lee ni se escribe ninguna cookie, no hay identificador y no
 * se guarda la IP.
 *
 * La IP se usa SÓLO en memoria para el rate limit. Sin él, un error
 * dentro de un bucle de render sería una petición por fotograma.
 *
 * Siempre responde 204: es telemetría, no una operación del usuario.
 * Devolver un error aquí sólo conseguiría ensuciar la consola de quien
 * ya está viendo la aplicación rota.
 */

/** Tope de cuerpo. Una pila larga cabe de sobra; un intento de abuso no. */
const MAX_BYTES = 8 * 1024

export async function POST(req: NextRequest) {
  const migraciones = await migrationsReady()
  if (!migraciones.ok) return new NextResponse(null, { status: 204 })

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'desconocida'
  // Más apretado que el resto de rutas a propósito: el cliente ya
  // deduplica por carga, así que un volumen alto desde una sola IP no es
  // un usuario con mala suerte, es alguien inflando la tabla.
  if (!rateLimit(`client-errors:${ip}`, 10)) return new NextResponse(null, { status: 204 })

  let crudo: string
  try {
    crudo = await req.text()
  } catch {
    return new NextResponse(null, { status: 204 })
  }
  if (crudo.length > MAX_BYTES) return new NextResponse(null, { status: 204 })

  let cuerpo: unknown
  try {
    cuerpo = JSON.parse(crudo)
  } catch {
    return new NextResponse(null, { status: 204 })
  }

  const entrada = normalizarError(cuerpo)
  if (!entrada) return new NextResponse(null, { status: 204 })

  await registrarErrorCliente(entrada)
  return new NextResponse(null, { status: 204 })
}
