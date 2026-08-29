import { NextRequest, NextResponse } from 'next/server'
import { confirmSubscriber, isValidEmail } from '@/lib/newsletter'
import { rateLimit } from '@/lib/rateLimit'

/**
 * Confirmación de newsletter (double opt-in). GET porque llega como enlace
 * desde el email. Valida el token almacenado y marca confirmed_at, luego
 * redirige a la home con ?newsletter=confirmed.
 */
export async function GET(req: NextRequest) {
  // Confirmar es una acción única por suscripción: un tope alto no
  // estorba y cierra la puerta a probar tokens en bucle.
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (!rateLimit(`nl-confirm:${ip}`, 10)) {
    return NextResponse.redirect(new URL('/?newsletter=error', req.nextUrl.origin))
  }

  const url = req.nextUrl
  const email = (url.searchParams.get('email') ?? '').toLowerCase().trim()
  const token = url.searchParams.get('token') ?? ''

  if (!isValidEmail(email) || !token) {
    return NextResponse.redirect(new URL('/?newsletter=error', url.origin))
  }

  const ok = await confirmSubscriber(email, token)
  return NextResponse.redirect(new URL(ok ? '/?newsletter=confirmed' : '/?newsletter=error', url.origin))
}
