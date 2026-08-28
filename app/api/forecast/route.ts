import { NextResponse } from 'next/server'
import { buildForecastCacheKey, buildUpstreamParams } from '@/lib/cacheKey'
import { getCachedForecast, getCachedForecastStale, setCachedForecast } from '@/lib/forecastCache'
import { rateLimit } from '@/lib/rateLimit'
import {
  detectModelsWithNoData,
  fetchOpenMeteoWithModelFallback,
  parseOpenMeteoResponse,
} from '@/lib/api/openMeteoProxy'
import { validateLatLon } from '@/lib/api/params'

// Cacheable responses get a generous TTL; stale fallbacks must NOT be
// cacheable in any shared layer (the staleness window is per-instance
// and the global CDN could otherwise keep an out-of-window response for
// up to s-maxage/24h).
//
// BUG FIX: the previous s-maxage=14400 (4h) coupled with the
// version-stamp `v=v3-...` cache key produced a hard-to-purge
// multi-version table in the Vercel edge cache. Every new
// CACHE_KEY_VERSION wrote a fresh row, and old rows never
// expired (the version param is part of the key, so the
// in-DB purge could not find them). We drop the shared-cache
// s-maxage to 1h so the version stamp purges itself naturally
// on the next deploy; the per-instance Turso cache still
// holds the body for 4h via the `forecast_cache` table.
const FRESH_CACHE_HEADERS = {
  'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=3600',
} as const
const STALE_CACHE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  'X-Forecast-Cache': 'stale',
} as const

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (!rateLimit(`forecast:${ip}`, 60)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }

  // B-NBT-9c: reject junk coordinates before they burn provider quota
  // or pollute the cache-key space.
  const coordError = validateLatLon(searchParams.get('latitude'), searchParams.get('longitude'))
  if (coordError) {
    return NextResponse.json({ error: coordError }, { status: 400 })
  }

  if (searchParams.get('timezone') !== 'auto') {
    searchParams.set('timezone', 'auto')
  }

  // Build the cache key BEFORE stripping internal-only params like
  // `v` (cache-bust stamp from `lib/openMeteo.ts`) so the version is
  // part of the hashed key. `buildUpstreamParams` then removes the
  // stripped params before forwarding to Open-Meteo.
  const cacheKey = buildForecastCacheKey(searchParams)
  const upstreamParams = buildUpstreamParams(searchParams)

  try {
    const cached = await getCachedForecast(cacheKey)
    if (cached) {
      return new NextResponse(cached.body, {
        status: 200,
        headers: {
          ...FRESH_CACHE_HEADERS,
          'Content-Type': 'application/json',
          'X-Forecast-Cache': 'hit',
          'X-Forecast-Cache-Age-Ms': String(cached.ageMs),
          'X-Forecast-Fetched-At': String(cached.fetchedAt),
        },
      })
    }
  } catch (err) {
    console.warn('forecast_cache lookup failed', err)
  }

  const upstream = `https://api.open-meteo.com/v1/forecast?${upstreamParams.toString()}`
  try {
    const { res, modelsRejected } = await fetchOpenMeteoWithModelFallback(
      upstream,
      upstreamParams,
      request.signal,
    )
    const text = await res.text()
    if (!res.ok) {
      const stale = await getCachedForecastStale(cacheKey).catch(() => null)
      if (stale) {
        return new NextResponse(stale.body, {
          status: 200,
          headers: {
            ...STALE_CACHE_HEADERS,
            'Content-Type': 'application/json',
            'X-Forecast-Cache-Age-Ms': String(stale.ageMs),
            'X-Forecast-Fetched-At': String(stale.fetchedAt),
          },
        })
      }
      return NextResponse.json(
        { error: `Open-Meteo ${res.status}` },
        { status: res.status }
      )
    }
    const fetchedAt = Date.now()
    const { parsed, bodyText } = parseOpenMeteoResponse(text)
    // Await the Turso write so the persistence completes before the
    // route hands control back to the runtime. On a serverless
    // function the response lifecycle ends very quickly after this
    // returns — fire-and-forget writes can be lost on a cold start
    // or when the runtime trims the event loop. We still wrap in
    // `try/catch` so a transient Turso outage doesn't 5xx the user.
    try {
      await setCachedForecast(cacheKey, bodyText, fetchedAt)
    } catch (err) {
      console.warn('forecast_cache write failed', err)
    }
    const headers: Record<string, string> = {
      ...FRESH_CACHE_HEADERS,
      'X-Forecast-Cache': 'miss',
      'X-Forecast-Fetched-At': String(fetchedAt),
    }
    if (modelsRejected.length > 0) {
      headers['X-Forecast-Models-Rejected'] = modelsRejected.join(',')
      console.warn(`forecast: Open-Meteo rejected models=${modelsRejected.join(',')}; served remainder`)
    }
    // B-NEW-41: some catalogue entries come back as all-null rows (HTTP
    // 200 but zero usable data — ecmwf_aifs025 / gfs_graphcast025 on
    // 2026-08-22). Surface them so operators can spot a degraded
    // ensemble instead of debugging "why is the forecast just ECMWF".
    const requestedModels = upstreamParams.get('models')?.split(',').filter(Boolean) ?? []
    const emptyModels = detectModelsWithNoData(parsed, requestedModels)
    if (emptyModels.length > 0) {
      headers['X-Forecast-Models-Empty'] = emptyModels.join(',')
      console.warn(`forecast: provider returned all-null payload for models=${emptyModels.join(',')}`)
    }
    return NextResponse.json(parsed, { headers })
  } catch {
    const stale = await getCachedForecastStale(cacheKey).catch(() => null)
    if (stale) {
      return new NextResponse(stale.body, {
        status: 200,
        headers: {
          ...STALE_CACHE_HEADERS,
          'Content-Type': 'application/json',
          'X-Forecast-Cache-Age-Ms': String(stale.ageMs),
          'X-Forecast-Fetched-At': String(stale.fetchedAt),
        },
      })
    }
    return NextResponse.json({ error: 'Failed to fetch forecast' }, { status: 502 })
  }
}
