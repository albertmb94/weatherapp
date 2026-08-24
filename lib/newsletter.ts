/**
 * B-NBT-17 (2026-08-22): tabla newsletter_subscribers para el sistema
 * de newsletter.
 */
import { db } from './db'

let schemaReady: Promise<boolean> | null = null

export async function ensureNewsletterSchema(): Promise<boolean> {
  if (schemaReady) return schemaReady
  schemaReady = db.ensure().then(async ok => {
    if (!ok) return false
    try {
      await db.execute(`CREATE TABLE IF NOT EXISTS newsletter_subscribers (
        email TEXT PRIMARY KEY,
        subscribed_at INTEGER NOT NULL,
        confirmed_at INTEGER,
        unsubscribed_at INTEGER
      )`)
      return true
    } catch {
      schemaReady = null
      return false
    }
  }).catch(() => { schemaReady = null; return false })
  return schemaReady
}
