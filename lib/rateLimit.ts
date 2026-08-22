const buckets = new Map<string, { tokens: number; lastRefill: number }>()

const DEFAULT_WINDOW_MS = 60_000
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

/** Token-bucket rate limiter used by every admin / API route.
 *  @param key          Per-bucket identifier (e.g. `admin:auth:1.2.3.4`).
 *  @param maxTokens    Max tokens per window. Defaults to 30/min.
 *  @param windowMs     Window length in milliseconds. Defaults to 60_000.
 *  @returns true if the request is allowed, false if the bucket is empty. */
export function rateLimit(key: string, maxTokens = MAX_TOKENS, windowMs = DEFAULT_WINDOW_MS): boolean {
  if (!purgeTimer) {
    purgeTimer = setInterval(purgeBuckets, PURGE_TTL_MS)
    // BUG FIX: the previous build leaked a Node `setInterval` on
    // every cold Lambda start because nothing called
    // `purgeTimer.unref()` and the timer kept the event loop
    // alive. On a Vercel function this can delay graceful
    // shutdown by up to PURGE_TTL_MS (10 min) for every new
    // invocation. `unref()` is a no-op in browsers, so the call
    // is safe across the edge + Node runtimes.
    if (typeof (purgeTimer as { unref?: () => void }).unref === 'function') {
      ;(purgeTimer as { unref: () => void }).unref()
    }
  }
  const now = Date.now()
  let bucket = buckets.get(key)

  if (!bucket) {
    bucket = { tokens: maxTokens, lastRefill: now }
    buckets.set(key, bucket)
  }

  const elapsed = now - bucket.lastRefill
  const refill = (elapsed / windowMs) * maxTokens
  bucket.tokens = Math.min(maxTokens, bucket.tokens + refill)
  bucket.lastRefill = now

  if (bucket.tokens < 1) return false
  bucket.tokens -= 1
  return true
}
