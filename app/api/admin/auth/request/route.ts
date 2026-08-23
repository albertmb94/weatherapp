import { NextRequest, NextResponse } from 'next/server'
import { directAdminToken, setAdminCookie } from '@/lib/admin/auth'
import { rateLimit } from '@/lib/rateLimit'

/**
 * B-NBT-11: magic link DESACTIVADO. Esta ruta solo mantiene el bypass
 * temporal del owner: si el email coincide EXACTAMENTE con
 * process.env.ADMIN_EMAIL se crea la sesión directa (token
 * determinista). Cualquier otro email responde de forma genérica
 * (anti-enumeración) sin hacer nada.
 *
 * Cuando se reactive los magic links, sustituir este bloque por
 * requestMagicLink + sendEmail (ver git history).
 */
export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (!rateLimit(`admin:auth:${ip}`, 5)) {
    return NextResponse.json({ ok: false, error: 'rate_limited' }, { status: 429 })
  }

  let email = ''
  try {
    const body = await req.json()
    email = String(body.email ?? '').toLowerCase().trim()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 })
  }
  if (!email || !email.includes('@')) {
    return NextResponse.json({ ok: false, error: 'invalid_email' }, { status: 400 })
  }

  const adminEmail = process.env.ADMIN_EMAIL?.toLowerCase().trim()
  const directToken = directAdminToken()
  if (adminEmail && directToken && email === adminEmail) {
    await setAdminCookie(directToken)
    return NextResponse.json({ ok: true, direct: true })
  }

  // Anti-enumeración: respuesta genérica idéntica al caso exitoso.
  return NextResponse.json({ ok: true, sent: false })
}
