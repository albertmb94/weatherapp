import { randomBytes } from 'crypto'
import { cache } from 'react'
import { cookies } from 'next/headers'
import { db } from '@/lib/db'

const COOKIE_NAME = 'wthr_admin'
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

let schemaReady: Promise<boolean> | null = null

async function ensureSchema(): Promise<boolean> {
  if (schemaReady) return schemaReady
  schemaReady = db.ensure().then(ok => {
    if (!ok) return false
    return db.execute(
      `CREATE TABLE IF NOT EXISTS admin_users (
        email TEXT PRIMARY KEY,
        name TEXT,
        role TEXT NOT NULL DEFAULT 'admin',
        created_at INTEGER NOT NULL,
        last_login_at INTEGER
      )`,
    ).then(() => db.execute(
      `CREATE TABLE IF NOT EXISTS admin_sessions (
        token TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'session',
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      )`,
    )).then(() => db.execute(
      `CREATE INDEX IF NOT EXISTS idx_admin_sessions_email ON admin_sessions(email)`,
    )).then(async () => {
      // Seed initial admin from env var
      const adminEmail = process.env.ADMIN_EMAIL?.toLowerCase().trim()
      if (adminEmail) {
        await db.execute(
          `INSERT OR IGNORE INTO admin_users (email, name, role, created_at) VALUES (?, ?, ?, ?)`,
          [adminEmail, 'Owner', 'superadmin', Date.now()],
        )
      }
      return true
    }).catch(() => false)
  }).catch(() => false)
  return schemaReady
}

function generateToken(): string {
  return randomBytes(32).toString('hex')
}

export { generateToken }

export async function isAdmin(email: string): Promise<boolean> {
  if (!(await ensureSchema())) return false
  const rows = await db.select<{ email: string }>(
    'SELECT email FROM admin_users WHERE email = ?',
    [email.toLowerCase()],
  )
  return rows.length > 0
}

export async function requestMagicLink(email: string): Promise<{ token: string; isNew: boolean } | null> {
  if (!(await ensureSchema())) return null
  const normalized = email.toLowerCase().trim()
  if (!normalized || !normalized.includes('@')) return null
  const exists = await isAdmin(normalized)
  if (!exists) return { token: '', isNew: false }
  const token = generateToken()
  const now = Date.now()
  await db.execute(
    'INSERT INTO admin_sessions (token, email, kind, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
    [token, normalized, 'magic_link', now + SESSION_TTL_MS, now],
  )
  return { token, isNew: true }
}

export async function consumeMagicLink(token: string): Promise<string | null> {
  if (!(await ensureSchema())) return null
  const rows = await db.select<{ email: string; expires_at: number; kind: string | null }>(
    'SELECT email, expires_at, kind FROM admin_sessions WHERE token = ?',
    [token],
  )
  const row = rows[0]
  if (!row) return null
  if (Number(row.expires_at) < Date.now()) {
    await db.execute('DELETE FROM admin_sessions WHERE token = ?', [token])
    return null
  }
  // One-time use for magic-link tokens. Active session tokens (set
  // by /api/admin/auth/verify after a successful magic-link exchange)
  // keep their row so the user stays logged in across reloads.
  if (row.kind === 'magic_link') {
    await db.execute('DELETE FROM admin_sessions WHERE token = ?', [token])
  }
  // Touch last_login_at
  await db.execute('UPDATE admin_users SET last_login_at = ? WHERE email = ?', [
    Date.now(),
    (row.email as string).toLowerCase(),
  ])
  return row.email as string
}

export async function validateAdminSession(token: string): Promise<string | null> {
  if (!(await ensureSchema())) return null
  const rows = await db.select<{ email: string; expires_at: number }>(
    'SELECT email, expires_at FROM admin_sessions WHERE token = ?',
    [token],
  )
  const row = rows[0]
  if (!row) return null
  if (Number(row.expires_at) < Date.now()) {
    await db.execute('DELETE FROM admin_sessions WHERE token = ?', [token])
    return null
  }
  return row.email as string
}

/** Memoised wrapper around `validateAdminSession`. Inside a single
 *  React render the same cookie is validated only once even if
 *  multiple server components call `getCurrentAdmin()`. The cache is
 *  per-request (cleared automatically once the response streams). */
export const getCurrentAdmin = cache(async (): Promise<string | null> => {
  const cookieStore = await cookies()
  const token = cookieStore.get(COOKIE_NAME)?.value
  if (!token) return null
  return validateAdminSession(token)
})

export async function destroyAdminSession(token: string): Promise<void> {
  if (!(await ensureSchema())) return
  await db.execute('DELETE FROM admin_sessions WHERE token = ?', [token])
}

export async function setAdminCookie(token: string): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_TTL_MS / 1000,
    path: '/',
  })
}

export async function clearAdminCookie(): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.delete(COOKIE_NAME)
}

export const ADMIN_COOKIE_NAME = COOKIE_NAME
export const ADMIN_SESSION_TTL_MS = SESSION_TTL_MS
