import { NextResponse } from 'next/server'
import { buildForecastCacheKey } from '@/lib/cacheKey'
import { getCachedForecast, getCachedForecastStale, setCachedForecast } from '@/lib/forecastCache'
import { rateLimit } from '@/lib/rateLimit'

// Open-Meteo can emit invalid JSON when a model has no coverage for a
// requested location: bare `nan`, `NaN`, `undefined`, or `Infinity` literals
// leak into the response body. We sanitize those tokens before parsing.
function sanitizeOpenMeteoJson(raw: string): string {
  return raw
    .replace(/:\s*nan\b/gi, ': null')
    .replace(/:\s*undefined\b/g, ': null')
    .replace(/:\s*-?Infinity\b/g, ': null')
}

const CACHE_HEADERS = {
  'Cache-Control': 'public, s-maxage=14400, stale-while-revalidate=3600',
}

const MAX_RETRIES = 3
const BASE_DELAY_MS = 1000
const MAX_RETRY_AFTER_MS = 8000
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504])

function parseRetryAfterMs(header: string | null): number | null {
  if (!header) return null
  const seconds = Number(header)
  if (Number.isFinite(seconds)) return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS)
  const dateMs = Date.parse(header)
  if (Number.isFinite(dateMs)) return Math.min(Math.max(dateMs - Date.now(), 0), MAX_RETRY_AFTER_MS)
  return null
}

async function fetchWithRetry(url: string): Promise<Response> {
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

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (!rateLimit(`forecast:${ip}`, 60)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }

  const cacheKey = buildForecastCacheKey(searchParams)

  // Cache lookup.
  try {
    const cached = await getCachedForecast(cacheKey)
    if (cached) {
      return new NextResponse(cached.body, {
        status: 200,
        headers: {
          ...CACHE_HEADERS,
          'Content-Type': 'application/json',
          'X-Forecast-Cache': 'hit',
          'X-Forecast-Cache-Age-Ms': String(cached.ageMs),
        },
      })
    }
  } catch (err) {
    // Cache lookup failure is non-fatal — fall through to origin.
    console.warn('forecast_cache lookup failed', err)
  }

  // Origin fetch with retry.
  const url = `https://api.open-meteo.com/v1/forecast?${searchParams.toString()}`
  try {
    const res = await fetchWithRetry(url)
    const text = await res.text()
    if (!res.ok) {
      // Try stale cache as fallback before returning error.
      const stale = await getCachedForecastStale(cacheKey).catch(() => null)
      if (stale) {
        return new NextResponse(stale.body, {
          status: 200,
          headers: {
            ...CACHE_HEADERS,
            'Content-Type': 'application/json',
            'X-Forecast-Cache': 'stale',
            'X-Forecast-Cache-Age-Ms': String(stale.ageMs),
          },
        })
      }
      return NextResponse.json(
        { error: `Open-Meteo ${res.status}`, detail: text },
        { status: res.status }
      )
    }
    let parsed: unknown
    let bodyText: string
    try {
      parsed = JSON.parse(text)
      bodyText = text
    } catch {
      bodyText = sanitizeOpenMeteoJson(text)
      parsed = JSON.parse(bodyText)
    }
    // Store sanitized text so cache hits are immediately valid JSON.
    setCachedForecast(cacheKey, bodyText).catch(err => {
      console.warn('forecast_cache write failed', err)
    })
    return NextResponse.json(parsed, { headers: { ...CACHE_HEADERS, 'X-Forecast-Cache': 'miss' } })
  } catch {
    // Network error — serve stale cache if available.
    const stale = await getCachedForecastStale(cacheKey).catch(() => null)
    if (stale) {
      return new NextResponse(stale.body, {
        status: 200,
        headers: {
          ...CACHE_HEADERS,
          'Content-Type': 'application/json',
          'X-Forecast-Cache': 'stale',
          'X-Forecast-Cache-Age-Ms': String(stale.ageMs),
        },
      })
    }
    return NextResponse.json({ error: 'Failed to fetch forecast' }, { status: 502 })
  }
}
