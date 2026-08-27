/**
 * B-NBT-17 (2026-08-22): tabla newsletter_subscribers para el sistema
 * de newsletter.
 *
 * Auditoría F4: se añade double opt-in. La fila se crea como pendiente
 * (confirmed_at NULL) con un confirm_token aleatorio; el usuario confirma
 * vía /api/newsletter/confirm. El unsubscribe marca unsubscribed_at.
 */
import { randomBytes } from 'crypto'
import { db } from './db'
import { memoizeSchema } from './schemaGuard'

export const ensureNewsletterSchema = memoizeSchema('newsletter', async () => {
  await db.execute(`CREATE TABLE IF NOT EXISTS newsletter_subscribers (
    email TEXT PRIMARY KEY,
    subscribed_at INTEGER NOT NULL,
    confirmed_at INTEGER,
    unsubscribed_at INTEGER
  )`)
  // Migración aditiva: token de confirmación para double opt-in.
  try {
    await db.execute(`ALTER TABLE newsletter_subscribers ADD COLUMN confirm_token TEXT`)
  } catch {
    /* columna ya existe */
  }
  // Token de BAJA, estable y por suscriptor. Sin él, /api/newsletter/
  // unsubscribe aceptaba solo un email: cualquiera podía dar de baja a
  // cualquiera con una sola petición, sabiendo únicamente su dirección.
  try {
    await db.execute(`ALTER TABLE newsletter_subscribers ADD COLUMN unsub_token TEXT`)
  } catch {
    /* columna ya existe */
  }
  // Los suscriptores anteriores a esta columna necesitan uno.
  await db.execute(
    `UPDATE newsletter_subscribers SET unsub_token = lower(hex(randomblob(16))) WHERE unsub_token IS NULL`,
  )
})

export function isValidEmail(email: string): boolean {
  // Validación básica pero real (no solo `includes('@')`): limita longitud
  // y exige una estructura razonable para evitar basura del tipo "@@@…".
  if (email.length > 254) return false
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)
}

export async function addPendingSubscriber(email: string): Promise<string | null> {
  if (!(await ensureNewsletterSchema())) return null
  const token = randomBytes(20).toString('hex')
  const unsub = randomBytes(16).toString('hex')
  const now = Date.now()
  try {
    await db.execute(
      `INSERT INTO newsletter_subscribers (email, subscribed_at, confirmed_at, unsubscribed_at, confirm_token, unsub_token)
       VALUES (?, ?, NULL, NULL, ?, ?)
       ON CONFLICT(email) DO UPDATE SET
         confirm_token = excluded.confirm_token,
         unsubscribed_at = NULL,
         subscribed_at = excluded.subscribed_at,
         -- El token de baja NO rota al resuscribirse: los enlaces de
         -- baja de correos ya enviados deben seguir funcionando.
         unsub_token = COALESCE(newsletter_subscribers.unsub_token, excluded.unsub_token)`,
      [email, now, token, unsub],
    )
    return token
  } catch (err) {
    console.warn('[newsletter] addPendingSubscriber failed:', err instanceof Error ? err.message : err)
    return null
  }
}

/** Token de baja del suscriptor. Va en el enlace "darse de baja" de cada
 *  envío; sin él la baja no se puede autorizar. */
export async function getUnsubToken(email: string): Promise<string | null> {
  if (!(await ensureNewsletterSchema())) return null
  const rows = await db.select<{ unsub_token: string | null }>(
    'SELECT unsub_token FROM newsletter_subscribers WHERE email = ?',
    [email.toLowerCase()],
  )
  return rows[0]?.unsub_token ?? null
}

export async function confirmSubscriber(email: string, token: string): Promise<boolean> {
  if (!(await ensureNewsletterSchema())) return false
  try {
    const rows = await db.select<{ confirm_token: string | null }>(
      'SELECT confirm_token FROM newsletter_subscribers WHERE email = ?',
      [email],
    )
    const stored = rows[0]?.confirm_token
    if (!stored || stored !== token) return false
    await db.execute(
      `UPDATE newsletter_subscribers SET confirmed_at = COALESCE(confirmed_at, ?), confirm_token = NULL WHERE email = ?`,
      [Date.now(), email],
    )
    return true
  } catch (err) {
    console.warn('[newsletter] confirmSubscriber failed:', err instanceof Error ? err.message : err)
    return false
  }
}

/**
 * Baja del boletín. Requiere el token del suscriptor.
 *
 * Antes bastaba con el email —sin ninguna prueba de propiedad— así que
 * cualquiera podía dar de baja a cualquiera con una sola petición. Se
 * devuelve el mismo resultado para "token incorrecto" y "email
 * inexistente" para no filtrar quién está suscrito.
 */
export async function unsubscribeSubscriber(email: string, token: string): Promise<boolean> {
  if (!(await ensureNewsletterSchema())) return false
  try {
    const rows = await db.select<{ unsub_token: string | null }>(
      'SELECT unsub_token FROM newsletter_subscribers WHERE email = ?',
      [email.toLowerCase()],
    )
    const stored = rows[0]?.unsub_token
    if (!stored || !token || stored.length !== token.length) return false
    // Comparación en tiempo constante: el token es un secreto.
    let diff = 0
    for (let i = 0; i < stored.length; i++) diff |= stored.charCodeAt(i) ^ token.charCodeAt(i)
    if (diff !== 0) return false

    await db.execute(
      `UPDATE newsletter_subscribers SET unsubscribed_at = ?, confirm_token = NULL WHERE email = ?`,
      [Date.now(), email.toLowerCase()],
    )
    return true
  } catch (err) {
    console.warn('[newsletter] unsubscribe failed:', err instanceof Error ? err.message : err)
    return false
  }
}
