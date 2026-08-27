import { NextRequest, NextResponse } from 'next/server'
import { getCurrentAdmin, generateToken, setAdminCookie } from '@/lib/admin/auth'
import { ADMIN_SESSION_TTL_MS } from '@/lib/admin/auth'
import { db } from '@/lib/db'
import { rateLimit } from '@/lib/rateLimit'
import { scryptSync, randomBytes, timingSafeEqual } from 'crypto'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const admin = await getCurrentAdmin()
  if (!admin) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  // Auditoría: esta ruta verifica una contraseña con scryptSync (~50-100ms
  // de CPU bloqueante) y no tenía NINGÚN límite, a diferencia del login.
  // Limitar por admin, no por IP: la sesión ya está autenticada.
  if (!rateLimit(`admin:pwd:${admin}`, 5)) {
    return NextResponse.json({ ok: false, error: 'rate_limited' }, { status: 429 })
  }

  let body: { current_password?: string; new_password?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 })
  }

  const current = body.current_password ?? ''
  const next = body.new_password ?? ''
  if (next.length < 8) return NextResponse.json({ ok: false, error: 'too_short' }, { status: 400 })

  const rows = await db.select<{ password_hash: string; username: string }>(
    'SELECT password_hash, username FROM admin_credentials WHERE email = ? LIMIT 1',
    [admin],
  )
  const cred = rows[0]
  if (!cred) return NextResponse.json({ ok: false, error: 'no_credentials' }, { status: 404 })

  const parts = cred.password_hash.split('$')
  if (parts[0] !== 's1' || !parts[1] || !parts[2]) {
    return NextResponse.json({ ok: false, error: 'bad_format' }, { status: 500 })
  }
  const expected = Buffer.from(parts[2], 'hex')
  const actual = scryptSync(current, Buffer.from(parts[1], 'hex'), 64)
  if (!timingSafeEqual(expected, actual)) {
    return NextResponse.json({ ok: false, error: 'wrong_password' }, { status: 401 })
  }

  const salt = randomBytes(16)
  const newHash = scryptSync(next, salt, 64)
  const newStored = `s1$${salt.toString('hex')}$${newHash.toString('hex')}`

  const updated = await db.execute(
    'UPDATE admin_credentials SET password_hash = ? WHERE username = ?',
    [newStored, cred.username],
  )
  if (!updated) return NextResponse.json({ ok: false, error: 'save_failed' }, { status: 503 })

  // Auditoría (S2): rotar la sesión NO revocaba las demás. Si cambias la
  // contraseña porque sospechas que te robaron una cookie, esa cookie
  // seguía siendo válida los 7 días restantes. Ahora se invalidan TODAS
  // las sesiones del admin y sólo después se emite la nueva — el orden
  // importa: al revés, el DELETE borraría también la recién creada.
  const revoked = await db.execute('DELETE FROM admin_sessions WHERE email = ?', [admin])
  if (!revoked) {
    // Fail-closed: si no podemos revocar, no confirmamos el cambio como
    // completo — el operador debe reintentar en vez de creerse seguro.
    return NextResponse.json({ ok: false, error: 'revoke_failed' }, { status: 503 })
  }

  const newToken = generateToken()
  const now = Date.now()
  const stored = await db.execute(
    'INSERT INTO admin_sessions (token, email, kind, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
    [newToken, admin, 'session', now + ADMIN_SESSION_TTL_MS, now],
  )
  if (!stored) {
    // La contraseña YA cambió y las sesiones están revocadas: sin fila en
    // admin_sessions la cookie no valida, así que el admin debe volver a
    // entrar con la contraseña nueva. Decirlo explícitamente.
    return NextResponse.json({ ok: true, reauth_required: true }, { status: 200 })
  }
  await setAdminCookie(newToken)

  return NextResponse.json({ ok: true, sessions_revoked: true })
}
