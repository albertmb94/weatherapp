const buckets = new Map<string, { tokens: number; lastRefill: number }>()

const WINDOW_MS = 60_000
const MAX_TOKENS = 30
const PURGE_TTL_MS = 10 * 60_000

function purgeBuckets() {
  const cutoff = Date.now() - PURGE_TTL_MS
  for (const [key, bucket] of buckets.entries()) {
    if (bucket.lastRefill < cutoff) {
      buckets.delete(key)
    }
  }
}

let purgeTimer: ReturnType<typeof setInterval> | null = null

export function rateLimit(key: string, maxTokens = MAX_TOKENS): boolean {
  if (!purgeTimer) {
    purgeTimer = setInterval(purgeBuckets, PURGE_TTL_MS)
  }
  const now = Date.now()
  let bucket = buckets.get(key)

  if (!bucket) {
    bucket = { tokens: maxTokens, lastRefill: now }
    buckets.set(key, bucket)
  }

  const elapsed = now - bucket.lastRefill
  const refill = (elapsed / WINDOW_MS) * maxTokens
  bucket.tokens = Math.min(maxTokens, bucket.tokens + refill)
  bucket.lastRefill = now

  if (bucket.tokens < 1) return false
  bucket.tokens -= 1
  return true
}
