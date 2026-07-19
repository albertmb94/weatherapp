import { NextResponse } from 'next/server'
import { buildMarineCacheKey } from '@/lib/cacheKey'
import { getCachedMarine, getCachedMarineStale, setCachedMarine } from '@/lib/marineCache'
import { rateLimit } from '@/lib/rateLimit'
import { fetchWithRetry, parseOpenMeteoResponse } from '@/lib/api/openMeteoProxy'

const FRESH_CACHE_HEADERS = {
  'Cache-Control': 'public, s-maxage=14400, stale-while-revalidate=3600',
} as const
const STALE_CACHE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
} as const

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (!rateLimit(`marine:${ip}`, 60)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }

  if (searchParams.get('timezone') !== 'auto') {
    searchParams.set('timezone', 'auto')
  }

  const cacheKey = buildMarineCacheKey(searchParams)

  try {
    const cached = await getCachedMarine(cacheKey)
    if (cached) {
      return new NextResponse(cached.body, {
        status: 200,
        headers: {
          ...FRESH_CACHE_HEADERS,
          'Content-Type': 'application/json',
          'X-Marine-Cache': 'hit',
          'X-Marine-Cache-Age-Ms': String(cached.ageMs),
          'X-Marine-Fetched-At': String(cached.fetchedAt),
        },
      })
    }
  } catch (err) {
    console.warn('marine_cache lookup failed', err)
  }

  const url = `https://marine-api.open-meteo.com/v1/marine?${searchParams.toString()}`
  try {
    const res = await fetchWithRetry(url)
    const text = await res.text()
    if (!res.ok) {
      const stale = await getCachedMarineStale(cacheKey).catch(() => null)
      if (stale) {
        return new NextResponse(stale.body, {
          status: 200,
          headers: {
            ...STALE_CACHE_HEADERS,
            'Content-Type': 'application/json',
            'X-Marine-Cache': 'stale',
            'X-Marine-Cache-Age-Ms': String(stale.ageMs),
            'X-Marine-Fetched-At': String(stale.fetchedAt),
          },
        })
      }
      return NextResponse.json(
        { error: `Open-Meteo Marine ${res.status}`, detail: text.slice(0, 500) },
        { status: res.status }
      )
    }
    const fetchedAt = Date.now()
    const { parsed, bodyText } = parseOpenMeteoResponse(text)
    setCachedMarine(cacheKey, bodyText, fetchedAt).catch(err => {
      console.warn('marine_cache write failed', err)
    })
    return NextResponse.json(parsed, {
      headers: {
        ...FRESH_CACHE_HEADERS,
        'X-Marine-Cache': 'miss',
        'X-Marine-Fetched-At': String(fetchedAt),
      },
    })
  } catch {
    const stale = await getCachedMarineStale(cacheKey).catch(() => null)
    if (stale) {
      return new NextResponse(stale.body, {
        status: 200,
        headers: {
          ...STALE_CACHE_HEADERS,
          'Content-Type': 'application/json',
          'X-Marine-Cache': 'stale',
          'X-Marine-Cache-Age-Ms': String(stale.ageMs),
          'X-Marine-Fetched-At': String(stale.fetchedAt),
        },
      })
    }
    return NextResponse.json({ error: 'Failed to fetch marine data' }, { status: 502 })
  }
}
