import { NextResponse } from 'next/server'
import { buildForecastCacheKey } from '@/lib/cacheKey'
import { getCachedForecast, setCachedForecast } from '@/lib/forecastCache'

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

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
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

  // Origin fetch.
  const url = `https://api.open-meteo.com/v1/forecast?${searchParams.toString()}`
  try {
    const res = await fetch(url)
    const text = await res.text()
    if (!res.ok) {
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
    return NextResponse.json({ error: 'Failed to fetch forecast' }, { status: 502 })
  }
}
