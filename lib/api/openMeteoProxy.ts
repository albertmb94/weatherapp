const MAX_RETRIES = 3
const BASE_DELAY_MS = 1000
const MAX_RETRY_AFTER_MS = 8000
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504])

export const CACHE_HEADERS = {
  'Cache-Control': 'public, s-maxage=14400, stale-while-revalidate=3600',
}

export function sanitizeOpenMeteoJson(raw: string): string {
  return raw
    .replace(/:\s*nan\b/gi, ': null')
    .replace(/:\s*undefined\b/g, ': null')
    .replace(/:\s*-?Infinity\b/g, ': null')
}

function parseRetryAfterMs(header: string | null): number | null {
  if (!header) return null
  const seconds = Number(header)
  if (Number.isFinite(seconds)) return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS)
  const dateMs = Date.parse(header)
  if (Number.isFinite(dateMs)) return Math.min(Math.max(dateMs - Date.now(), 0), MAX_RETRY_AFTER_MS)
  return null
}

export async function fetchWithRetry(url: string): Promise<Response> {
  let res = await fetch(url)
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (res.ok || !RETRYABLE_STATUSES.has(res.status)) return res
    const retryAfterMs = parseRetryAfterMs(res.headers.get('retry-after'))
    const delay = retryAfterMs ?? BASE_DELAY_MS * Math.pow(2, attempt)
    await new Promise(r => setTimeout(r, delay))
    res = await fetch(url)
  }
  return res
}

export function parseOpenMeteoResponse(text: string): { parsed: unknown; bodyText: string } {
  try {
    return { parsed: JSON.parse(text), bodyText: text }
  } catch {
    const bodyText = sanitizeOpenMeteoJson(text)
    return { parsed: JSON.parse(bodyText), bodyText }
  }
}
