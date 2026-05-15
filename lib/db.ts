import { createClient, type Client } from '@libsql/client'

let cached: Client | null = null

export function getDb(): Client {
  if (cached) return cached
  const tursoUrl = process.env.TURSO_DATABASE_URL
  const tursoToken = process.env.TURSO_AUTH_TOKEN
  if (process.env.NODE_ENV === 'production' && !tursoUrl) {
    throw new Error(
      'TURSO_DATABASE_URL is required in production. Set it in the Vercel project env vars.'
    )
  }
  cached = createClient({
    url: tursoUrl ?? 'file:local.db',
    authToken: tursoToken,
  })
  return cached
}
