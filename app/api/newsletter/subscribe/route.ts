import { NextRequest, NextResponse } from 'next/server'
import { addPendingSubscriber, isValidEmail } from '@/lib/newsletter'
import { sendEmail } from '@/lib/emails'
import { appOrigin } from '@/lib/appUrl'
import { rateLimit } from '@/lib/rateLimit'

/**
 * B-NBT-17 / auditoría F4: public newsletter subscribe (double opt-in).
 * POST {email} → crea suscriptor pendiente y envía email de confirmación.
 * El usuario confirma en /api/newsletter/confirm. Rate limited 3/min/IP.
 */
export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (!rateLimit(`newsletter:${ip}`, 3)) {
    return NextResponse.json({ ok: false, error: 'rate_limited' }, { status: 429 })
  }

  let email = ''
  try {
    const body = await req.json()
    email = String(body.email ?? '').toLowerCase().trim()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 })
  }
  if (!isValidEmail(email)) {
    return NextResponse.json({ ok: false, error: 'invalid_email' }, { status: 400 })
  }

  const token = await addPendingSubscriber(email)
  if (!token) {
    return NextResponse.json({ ok: false, error: 'db_error' }, { status: 503 })
  }

  // Best-effort: si el envío falla, el suscriptor queda pendiente y puede
  // reintentar; nunca bloqueamos la respuesta (el usuario ya ve "revisa tu email").
  const origin = appOrigin(req.nextUrl.origin)
  const confirmUrl = `${origin}/api/newsletter/confirm?email=${encodeURIComponent(email)}&token=${token}`
  await sendEmail({
    to: email,
    templateId: 'newsletter_confirm',
    locale: 'es',
    vars: { confirm_url: confirmUrl },
    metadata: { source: 'newsletter_subscribe' },
    sentBy: 'newsletter-subscribe',
  })

  return NextResponse.json({ ok: true, pending: true, message: 'revisa tu email para confirmar' })
}
