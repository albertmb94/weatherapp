import { NextRequest, NextResponse } from 'next/server'
import { confirmSubscriber, isValidEmail } from '@/lib/newsletter'

/**
 * Confirmación de newsletter (double opt-in). GET porque llega como enlace
 * desde el email. Valida el token almacenado y marca confirmed_at, luego
 * redirige a la home con ?newsletter=confirmed.
 */
export async function GET(req: NextRequest) {
  const url = req.nextUrl
  const email = (url.searchParams.get('email') ?? '').toLowerCase().trim()
  const token = url.searchParams.get('token') ?? ''

  if (!isValidEmail(email) || !token) {
    return NextResponse.redirect(new URL('/?newsletter=error', url.origin))
  }

  const ok = await confirmSubscriber(email, token)
  return NextResponse.redirect(new URL(ok ? '/?newsletter=confirmed' : '/?newsletter=error', url.origin))
}
