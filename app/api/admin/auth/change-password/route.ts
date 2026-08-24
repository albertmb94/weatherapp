import { NextRequest, NextResponse } from 'next/server'
import { getCurrentAdmin, generateToken, setAdminCookie } from '@/lib/admin/auth'
import { ADMIN_SESSION_TTL_MS } from '@/lib/admin/auth'
import { db } from '@/lib/db'
import { scryptSync, randomBytes, timingSafeEqual } from 'crypto'

export async function POST(req: NextRequest) {
  const admin = await getCurrentAdmin()
  if (!admin) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

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

  // Rotar sesión
  const newToken = generateToken()
  await db.execute(
    'INSERT INTO admin_sessions (token, email, kind, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
    [newToken, admin, 'session', Date.now() + ADMIN_SESSION_TTL_MS, Date.now()],
  )
  await setAdminCookie(newToken)

  return NextResponse.json({ ok: true })
}
