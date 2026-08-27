import { NextRequest, NextResponse } from 'next/server'
import { isValidEmail, unsubscribeSubscriber } from '@/lib/newsletter'
import { rateLimit } from '@/lib/rateLimit'

/**
 * Baja de newsletter. POST {email, token} → marca unsubscribed_at.
 *
 * El token va en el enlace "darse de baja" de cada envío. Sin él,
 * bastaba con conocer una dirección para dar de baja a su dueño.
 * Sigue cumpliendo el RGPD: un clic desde el correo, sin login.
 * Rate limited 5/min/IP.
 */
export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (!rateLimit(`newsletter:unsub:${ip}`, 5)) {
    return NextResponse.json({ ok: false, error: 'rate_limited' }, { status: 429 })
  }

  let email = ''
  let token = ''
  try {
    const body = await req.json()
    email = String(body.email ?? '').toLowerCase().trim()
    token = String(body.token ?? '').trim()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 })
  }
  if (!isValidEmail(email)) {
    return NextResponse.json({ ok: false, error: 'invalid_email' }, { status: 400 })
  }
  if (!token) {
    return NextResponse.json({ ok: false, error: 'missing_token' }, { status: 400 })
  }

  await unsubscribeSubscriber(email, token)
  // Siempre ok, tanto si el token era válido como si no: no revelamos si
  // el email existe ni si el token acertó (anti-enumeración).
  return NextResponse.json({ ok: true })
}
