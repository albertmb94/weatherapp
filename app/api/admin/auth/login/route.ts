import { NextRequest, NextResponse } from 'next/server'
import {
  applyAdminCookieToResponse,
  directAdminToken,
  generateToken,
  setAdminCookie,
  ADMIN_SESSION_TTL_MS,
  verifyAdminLogin,
} from '@/lib/admin/auth'
import { db } from '@/lib/db'
import { rateLimit } from '@/lib/rateLimit'

/**
 * B-NBT-11: login clÃ¡sico usuario + contraseÃ±a.
 *
 * DOS modos en el mismo endpoint:
 *   - Formulario nativo (sin JS): fields urlencoded â†’ verifica y
 *     responde 303 redirect a /admin o /admin/login?error=â€¦
 *     Funciona aunque la hidrataciÃ³n muera (misma filosofÃ­a que el
 *     fallback del banner de cookies).
 *   - fetch JSON ({username,password}) â†’ devuelve {ok:true} para
 *     callers programÃ¡ticos.
 *
 * Magic link DESACTIVADO por completo. Rate limit 5/min/IP.
 */
export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (!rateLimit(`admin:login:${ip}`, 5)) {
    const accept = req.headers.get('accept') ?? ''
    if (!accept.includes('application/json')) {
      return NextResponse.redirect(new URL('/admin/login?error=rate', req.url), 303)
    }
    return NextResponse.json({ ok: false, error: 'rate_limited' }, { status: 429 })
  }

  const contentType = req.headers.get('content-type') ?? ''
  const isForm = contentType.includes('application/x-www-form-urlencoded')
  let username = ''
  let password = ''
  try {
    if (isForm) {
      const form = await req.formData()
      username = String(form.get('username') ?? '').trim()
      password = String(form.get('password') ?? '')
    } else {
      const body = await req.json()
      username = String(body.username ?? '').trim()
      password = String(body.password ?? '')
    }
  } catch {
    if (isForm) return NextResponse.redirect(new URL('/admin/login?error=invalid', req.url), 303)
    return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 })
  }
  if (!username || !password) {
    if (isForm) return NextResponse.redirect(new URL('/admin/login?error=missing', req.url), 303)
    return NextResponse.json({ ok: false, error: 'missing_fields' }, { status: 400 })
  }

  const email = await verifyAdminLogin(username, password)
  if (!email) {
    // Mensaje genÃ©rico: no revelar si fallÃ³ el usuario o la contraseÃ±a.
    if (isForm) return NextResponse.redirect(new URL('/admin/login?error=credentials', req.url), 303)
    return NextResponse.json({ ok: false, error: 'invalid_credentials' }, { status: 401 })
  }

  // B-NBT-11: la cookie de sesión es el TOKEN DETERMINISTA del owner
  // (directAdminToken) para que la validación en layout/APIs no dependa
  // de la salud de admin_sessions en cada copia del bundle. La fila en
  // admin_sessions se inserta como best-effort para auditoría.
  const sessionToken = directAdminToken() ?? generateToken()
  const now = Date.now()
  try {
    await db.execute(
      'INSERT OR IGNORE INTO admin_sessions (token, email, kind, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
      [sessionToken, email, 'session', now + ADMIN_SESSION_TTL_MS, now],
    )
    await db.execute('UPDATE admin_users SET last_login_at = ? WHERE email = ?', [now, email])
  } catch {
    /* best-effort: la cookie determinista valida sin fila */
  }
  await setAdminCookie(sessionToken)
  if (isForm) {
    // B-NBT-11: adjuntar la cookie EXPLÍCITAMENTE a la respuesta de
    // redirect — cookies().set no siempre se fusiona con
    // NextResponse.redirect en Route Handlers.
    const res = NextResponse.redirect(new URL('/admin', req.url), 303)
    applyAdminCookieToResponse(res, sessionToken)
    return res
  }
  return NextResponse.json({ ok: true })
}
