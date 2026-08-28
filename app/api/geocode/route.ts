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

  // AUDITORIA: antes se reenviaba el query string COMPLETO del cliente al
  // proveedor. El host es fijo, asi que no es SSRF, pero cualquiera podia
  // colar `count=10000` y quemar la cuota compartida a traves de un
  // endpoint nuestro cacheado en CDN. Se construyen los parametros desde
  // cero con una lista blanca y topes.
  const upstream = new URLSearchParams({ name: name.trim().slice(0, 120) })
  const count = Number(searchParams.get('count'))
  upstream.set('count', String(Number.isFinite(count) ? Math.min(Math.max(count, 1), 20) : 10))
  const language = searchParams.get('language')
  if (language && /^[a-z]{2}$/i.test(language)) upstream.set('language', language.toLowerCase())
  upstream.set('format', 'json')

  const url = `https://geocoding-api.open-meteo.com/v1/search?${upstream.toString()}`

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
