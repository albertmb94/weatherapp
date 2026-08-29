import { NextRequest, NextResponse } from 'next/server'
import {
  applyAdminCookieToResponse,
  generateToken,
  setAdminCookie,
  ADMIN_SESSION_TTL_MS,
  verifyAdminLogin,
} from '@/lib/admin/auth'
import { db } from '@/lib/db'
import { rateLimit } from '@/lib/rateLimit'

/**
 * B-NBT-11: login clásico usuario + contraseña.
 *
 * DOS modos en el mismo endpoint:
 *   - Formulario nativo (sin JS): fields urlencoded → verifica y
 *     responde 303 redirect a /admin o /admin/login?error=…
 *     Funciona aunque la hidratación muera (misma filosofía que el
 *     fallback del banner de cookies).
 *   - fetch JSON ({username,password}) → devuelve {ok:true} para
 *     callers programáticos.
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
    // Mensaje genérico: no revelar si falló el usuario o la contraseña.
    if (isForm) return NextResponse.redirect(new URL('/admin/login?error=credentials', req.url), 303)
    return NextResponse.json({ ok: false, error: 'invalid_credentials' }, { status: 401 })
  }

  // Sesión aleatoria de 256 bits persistida en admin_sessions: expira a
  // los ADMIN_SESSION_TTL_MS, es revocable (logout / change-password la
  // borran) y NO depende de ningún secreto derivable.
  const sessionToken = generateToken()
  const now = Date.now()
  try {
    // ESTRICTO, y el comentario de abajo sólo era cierto con esto:
    // `db.execute` no lanza nunca, así que el catch era código muerto y
    // un INSERT fallido dejaba poner la cookie igualmente. El resultado
    // era un BUCLE DE LOGIN sin explicación: entras, te redirige a
    // /admin, la sesión no valida por no tener fila, y vuelves al login.
    await db.executeOrThrow(
      'INSERT OR REPLACE INTO admin_sessions (token, email, kind, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
      [sessionToken, email, 'session', now + ADMIN_SESSION_TTL_MS, now],
    )
    // El último acceso es informativo: que no se pueda anotar no debe
    // impedir entrar, así que este sigue siendo permisivo a propósito.
    await db.execute('UPDATE admin_users SET last_login_at = ? WHERE email = ?', [now, email])
  } catch (err) {
    console.error('[admin] login: no se pudo registrar la sesión:', err instanceof Error ? err.message : err)
    // Fail-closed: sin fila en admin_sessions la sesión no valida.
    if (isForm) return NextResponse.redirect(new URL('/admin/login?error=store', req.url), 303)
    return NextResponse.json({ ok: false, error: 'session_store_unavailable' }, { status: 503 })
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
