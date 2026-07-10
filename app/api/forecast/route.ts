import { NextResponse } from 'next/server'
import { buildForecastCacheKey } from '@/lib/cacheKey'
import { getCachedForecast, getCachedForecastStale, setCachedForecast } from '@/lib/forecastCache'
import { rateLimit } from '@/lib/rateLimit'
import { fetchWithRetry, parseOpenMeteoResponse, CACHE_HEADERS } from '@/lib/api/openMeteoProxy'

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
          ...CACHE_HEADERS,
          'Content-Type': 'application/json',
          'X-Forecast-Cache': 'hit',
          'X-Forecast-Cache-Age-Ms': String(cached.ageMs),
        },
      })
    }
  } catch (err) {
    console.warn('forecast_cache lookup failed', err)
  }

  const url = `https://api.open-meteo.com/v1/forecast?${searchParams.toString()}`
  try {
    const res = await fetchWithRetry(url)
    const text = await res.text()
    if (!res.ok) {
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
    const { parsed, bodyText } = parseOpenMeteoResponse(text)
    setCachedForecast(cacheKey, bodyText).catch(err => {
      console.warn('forecast_cache write failed', err)
    })
    return NextResponse.json(parsed, { headers: { ...CACHE_HEADERS, 'X-Forecast-Cache': 'miss' } })
  } catch {
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
