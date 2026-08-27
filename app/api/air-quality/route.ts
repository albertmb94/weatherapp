import { NextResponse } from 'next/server'
import { rateLimit } from '@/lib/rateLimit'
import { validateLatLon } from '@/lib/api/params'

// F5: air-quality + pollen via the dedicated Open-Meteo
// air-quality endpoint. Kept as a separate route so we can
// cache / rate-limit it independently from the main forecast
// (the air-quality endpoint has a more restrictive quota).

// Cacheable responses get a generous TTL; air quality changes
// on the order of hours, so 1h shared + 1h SWR is a good
// trade-off between freshness and upstream load.
const FRESH_CACHE_HEADERS = {
  'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=3600',
} as const

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  // 30 req/min/IP — the air-quality endpoint has a tighter
  // global quota than the main forecast endpoint.
  if (!rateLimit(`air-quality:${ip}`, 30)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }

  // B-NBT-9c: reject junk coordinates before they burn provider quota.
  const coordError = validateLatLon(searchParams.get('latitude'), searchParams.get('longitude'))
  if (coordError) {
    return NextResponse.json({ error: coordError }, { status: 400 })
  }

  if (searchParams.get('timezone') !== 'auto') {
    searchParams.set('timezone', 'auto')
  }

  // Strip the version stamp before forwarding upstream.
  const upstreamParams = new URLSearchParams(searchParams)
  upstreamParams.delete('v')

  const url = `https://air-quality-api.open-meteo.com/v1/air-quality?${upstreamParams.toString()}`
  try {
    const res = await fetch(url, {
      // Same 20-s budget as the main forecast.
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return NextResponse.json(
        { error: `Open-Meteo Air Quality ${res.status}`, detail: text.slice(0, 500) },
        { status: res.status }
      )
    }
    const data = await res.json()
    return NextResponse.json(data, {
      headers: {
        ...FRESH_CACHE_HEADERS,
        'X-Air-Quality-Fetched-At': String(Date.now()),
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json(
      { error: 'Failed to fetch air quality', detail: message },
      { status: 502 }
    )
  }
}
