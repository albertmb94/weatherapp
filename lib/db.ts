import { createClient } from '@libsql/client'

const tursoUrl = process.env.TURSO_DATABASE_URL
const tursoToken = process.env.TURSO_AUTH_TOKEN

// In production we require Turso. The `file:` fallback would fail anyway
// because Vercel serverless filesystems are read-only outside /tmp, and
// the data would not persist across invocations.
if (process.env.NODE_ENV === 'production' && !tursoUrl) {
  throw new Error(
    'TURSO_DATABASE_URL is required in production. Set it in the Vercel project env vars.'
  )
}

export const db = createClient({
  url: tursoUrl ?? 'file:local.db',
  authToken: tursoToken,
})
