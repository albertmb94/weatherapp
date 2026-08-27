import { NextResponse } from 'next/server'
import { rateLimit } from '@/lib/rateLimit'

// B-NBT-9c (2026-08-22):
//   - `export const revalidate = 3600` was a no-op here: this handler
//     reads request.url, so the route is dynamic and Next never caches
//     it. Removed rather than left as a misleading promise.
//   - The response now carries an explicit CDN cache header (city
//     search results are stable for hours), matching reverse-geocode.
//   - The upstream fetch finally has a timeout like every other
//     provider call in the repo, and an empty `name` is rejected
//     before it burns quota.
export async function GET(request: Request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (!rateLimit(`geocode:${ip}`, 30)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }

  const { searchParams } = new URL(request.url)
  const name = searchParams.get('name')
  if (!name || name.trim().length === 0) {
    return NextResponse.json({ error: 'Missing name' }, { status: 400 })
  }

  const url = `https://geocoding-api.open-meteo.com/v1/search?${searchParams.toString()}`

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
    if (!res.ok) {
      return NextResponse.json({ error: 'Geocoding API error' }, { status: res.status })
    }
    const data = await res.json()
    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
      },
    })
  } catch {
    return NextResponse.json({ error: 'Failed to geocode' }, { status: 502 })
  }
}
