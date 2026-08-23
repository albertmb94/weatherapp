import { NextRequest, NextResponse } from 'next/server'
import { isAdmin, requestMagicLink, directAdminToken, setAdminCookie } from '@/lib/admin/auth'
import { sendEmail } from '@/lib/emails'
import { rateLimit } from '@/lib/rateLimit'

export async function POST(req: NextRequest) {
  // Per-IP throttling: 5 requests/min. Magic link flows are
  // user-initiated so the cap is generous; the goal is to deflect
  // enumeration attacks on the admin endpoint.
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
  // ⚠️ TEMPORARY BYPASS (B-NBT-10, petición del owner): mientras el
  // magic link está desactivado, el superadmin entra directo si el email
  // coincide EXACTAMENTE con process.env.ADMIN_EMAIL. Sin dependencia de
  // DB (isAdmin/tablas): el entorno es la única fuente de verdad.
  // Cuando se reactive los magic links, ELIMINAR este bloque completo.
  const adminEmail = process.env.ADMIN_EMAIL?.toLowerCase().trim()
  const directToken = directAdminToken()
  if (adminEmail && email === adminEmail && directToken) {
    await setAdminCookie(directToken)
    return NextResponse.json({ ok: true, direct: true })
  }

  const exists = await isAdmin(email)
  if (!exists) {
    // Don't reveal whether the email is admin — respond as if it were sent.
    return NextResponse.json({ ok: true, sent: false })
  }
  const result = await requestMagicLink(email)
  if (!result || !result.token) {
    return NextResponse.json({ ok: false, error: 'failed' }, { status: 500 })
  }
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || req.nextUrl.origin
  const verifyUrl = `${appUrl}/admin/login/verify?token=${result.token}`
  // Attempt to send via Resend (no-op if feature disabled).
  const send = await sendEmail({
    to: email,
    subject: 'Weather Admin Â· Magic link',
    html: `<p>Hola,</p><p>Haz clic para acceder al panel de administraciÃ³n:</p><p><a href="${verifyUrl}" style="background:#0a7aff;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block">Acceder</a></p><p>Si no has solicitado este enlace puedes ignorarlo.</p>`,
    plainText: `Accede al panel de admin: ${verifyUrl}`,
    metadata: { kind: 'admin_magic_link' },
  })

  // Always log the link to the server console + a single-line banner
  // so the developer (or the Vercel logs viewer) can grab the link
  // without needing Resend configured. The single-line format is
  // grep-friendly.
  if (!send.ok) {
    const reason = send.error ?? 'skipped'
    // eslint-disable-next-line no-console
    console.log(`[admin] magic link | email=${email} | url=${verifyUrl} | resend=${reason}`)
  }


  return NextResponse.json({ ok: true, sent: true, delivered: send.ok })
}
