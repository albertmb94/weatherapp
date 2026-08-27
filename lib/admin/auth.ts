import { randomBytes, scryptSync, timingSafeEqual } from 'crypto'
import { cache } from 'react'
import { cookies } from 'next/headers'
import { db } from '@/lib/db'
import { memoizeSchema } from '@/lib/schemaGuard'

const COOKIE_NAME = 'wthr_admin'
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

export const ADMIN_COOKIE_NAME = COOKIE_NAME
export const ADMIN_SESSION_TTL_MS = SESSION_TTL_MS

/**
 * B-NBT-11 (2026-08-22): magic link DESACTIVADO por completo a petición
 * del owner. El acceso al panel es usuario + contraseña clásicos contra
 * la tabla `admin_credentials` (hash scrypt con salt aleatorio).
 *
 * Credenciales sembradas en el primer arranque SOLO si la env
 * ADMIN_PASSWORD está definida (nunca se siembra una contraseña
 * conocida/publicada en el repo). Rotación posterior desde /admin/settings.
 */

export const DEFAULT_ADMIN_USERNAME = 'admin'

const ensureSchema = memoizeSchema('admin', async () => {
  await db.execute(
    `CREATE TABLE IF NOT EXISTS admin_users (
      email TEXT PRIMARY KEY,
      name TEXT,
      role TEXT NOT NULL DEFAULT 'admin',
      created_at INTEGER NOT NULL,
      last_login_at INTEGER
    )`,
  )
  await db.execute(
    `CREATE TABLE IF NOT EXISTS admin_sessions (
      token TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'session',
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )`,
  )
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_admin_sessions_email ON admin_sessions(email)`,
  )
  await db.execute(
    `CREATE TABLE IF NOT EXISTS admin_credentials (
      username TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`,
  )

  // Seed initial admin identity from env var
  const adminEmail = process.env.ADMIN_EMAIL?.toLowerCase().trim()
  if (adminEmail) {
    await db.execute(
      `INSERT OR IGNORE INTO admin_users (email, name, role, created_at) VALUES (?, ?, ?, ?)`,
      [adminEmail, 'Owner', 'superadmin', Date.now()],
    )
  }
  // Seed default username/password ONLY when the table is empty AND
  // ADMIN_PASSWORD is explicitly provided — nunca se siembra una
  // contraseña conocida (publicada en el repo) ni un default fijo.
  const seededPassword = process.env.ADMIN_PASSWORD
  const count = await db.select<{ n: number }>('SELECT COUNT(*) AS n FROM admin_credentials')
  if (Number(count[0]?.n ?? 0) === 0) {
    if (!seededPassword) {
      console.warn(
        '[admin] Sin credenciales: define ADMIN_PASSWORD (+ opcionalmente ADMIN_USERNAME) ' +
          'para sembrar el acceso inicial, o inserta la fila en admin_credentials manualmente.',
      )
    } else {
      const email = adminEmail ?? 'admin@local'
      await db.execute(
        `INSERT OR IGNORE INTO admin_credentials (username, email, password_hash, created_at)
         VALUES (?, ?, ?, ?)`,
        [
          process.env.ADMIN_USERNAME?.toLowerCase().trim() || DEFAULT_ADMIN_USERNAME,
          email,
          hashPassword(seededPassword),
          Date.now(),
        ],
      )
    }
  }
})
// ---------------------------------------------------------------------------
// Password hashing (scrypt nativo de Node — sin dependencias nuevas)
// ---------------------------------------------------------------------------

const SCRYPT_KEYLEN = 64

export function hashPassword(password: string): string {
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN)
  return `s1$${salt.toString('hex')}$${hash.toString('hex')}`
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [version, saltHex, hashHex] = stored.split('$')
    if (version !== 's1' || !saltHex || !hashHex) return false
    const expected = Buffer.from(hashHex, 'hex')
    const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), SCRYPT_KEYLEN)
    return timingSafeEqual(expected, actual)
  } catch {
    return false
  }
}

function generateToken(): string {
  return randomBytes(32).toString('hex')
}

export { generateToken }

/** Usuario + contraseña correctos → el email asociado (o null). */
export async function verifyAdminLogin(
  username: string,
  password: string,
): Promise<string | null> {
  if (!(await ensureSchema())) return null
  const normalized = username.toLowerCase().trim()
  if (!normalized || !password) return null
  const rows = await db.select<{ email: string; password_hash: string }>(
    'SELECT email, password_hash FROM admin_credentials WHERE username = ?',
    [normalized],
  )
  const row = rows[0]
  if (!row) return null
  if (!verifyPassword(password, row.password_hash)) return null
  return row.email.toLowerCase()
}

export async function isAdmin(email: string): Promise<boolean> {
  if (!(await ensureSchema())) return false
  const rows = await db.select<{ email: string }>(
    'SELECT email FROM admin_users WHERE email = ?',
    [email.toLowerCase()],
  )
  return rows.length > 0
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
  // B-NBT-10 fix: con el opt-in self-hosted (DB_ALLOW_FILE_IN_PRODUCTION)
  // el despliegue corre sobre HTTP sin TLS; una cookie Secure no se
  // enviaría jamás y el login rebotaría al formulario. En Vercel (sin el
  // flag) se mantiene Secure=true.
  const selfHostedHttp =
    process.env.DB_ALLOW_FILE_IN_PRODUCTION === '1' ||
    process.env.DB_ALLOW_FILE_IN_PRODUCTION === 'true'
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production' && !selfHostedHttp,
    maxAge: SESSION_TTL_MS / 1000,
    path: '/',
  })
}

/** B-NBT-11: adjunta la cookie de sesión a una respuesta EXPLÍCITA
 *  (p.ej. NextResponse.redirect del login con formulario nativo),
 *  donde cookies().set de next/headers no siempre se fusiona. */
export function applyAdminCookieToResponse(
  res: { cookies: { set: (options: {
    name: string
    value: string
    httpOnly?: boolean
    sameSite?: boolean | 'strict' | 'lax' | 'none'
    secure?: boolean
    maxAge?: number
    path?: string
  }) => void } },
  token: string,
): void {
  const selfHostedHttp =
    process.env.DB_ALLOW_FILE_IN_PRODUCTION === '1' ||
    process.env.DB_ALLOW_FILE_IN_PRODUCTION === 'true'
  res.cookies.set({
    name: ADMIN_COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production' && !selfHostedHttp,
    maxAge: SESSION_TTL_MS / 1000,
    path: '/',
  })
}
export async function clearAdminCookie(): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.delete(COOKIE_NAME)
}
