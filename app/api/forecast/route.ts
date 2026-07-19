import { NextResponse } from 'next/server'
import { buildForecastCacheKey } from '@/lib/cacheKey'
import { getCachedForecast, getCachedForecastStale, setCachedForecast } from '@/lib/forecastCache'
import { rateLimit } from '@/lib/rateLimit'
import {
  fetchOpenMeteoWithModelFallback,
  parseOpenMeteoResponse,
} from '@/lib/api/openMeteoProxy'

// Cacheable responses get a generous TTL; stale fallbacks must NOT be
// cacheable in any shared layer (the staleness window is per-instance
// and the global CDN could otherwise keep an out-of-window response for
// up to s-maxage/24h).
const FRESH_CACHE_HEADERS = {
  'Cache-Control': 'public, s-maxage=14400, stale-while-revalidate=3600',
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

  if (searchParams.get('timezone') !== 'auto') {
    searchParams.set('timezone', 'auto')
  }

  const cacheKey = buildForecastCacheKey(searchParams)

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

  const upstream = `https://api.open-meteo.com/v1/forecast?${searchParams.toString()}`
  try {
    const { res, modelsRejected } = await fetchOpenMeteoWithModelFallback(upstream, searchParams)
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
        { error: `Open-Meteo ${res.status}`, detail: text.slice(0, 500) },
        { status: res.status }
      )
    }
    const fetchedAt = Date.now()
    const { parsed, bodyText } = parseOpenMeteoResponse(text)
    setCachedForecast(cacheKey, bodyText, fetchedAt).catch(err => {
      console.warn('forecast_cache write failed', err)
    })
    const headers: Record<string, string> = {
      ...FRESH_CACHE_HEADERS,
      'X-Forecast-Cache': 'miss',
      'X-Forecast-Fetched-At': String(fetchedAt),
    }
    if (modelsRejected.length > 0) {
      headers['X-Forecast-Models-Rejected'] = modelsRejected.join(',')
      console.warn(`forecast: Open-Meteo rejected models=${modelsRejected.join(',')}; served remainder`)
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
