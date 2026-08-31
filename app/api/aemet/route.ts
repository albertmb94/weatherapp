import { NextResponse } from 'next/server'
import { fetchAemetStations, getStaleAemetStations, type AemetRaw } from '@/lib/aemet'
import { parametrosSeleccion, seleccionarEstaciones } from '@/lib/stations/seleccion'
import { rateLimit } from '@/lib/rateLimit'
import {
  getFreshCachedStations,
  getStaleCachedStations,
  setCachedStations,
  parseStationsPayload,
} from '@/lib/externalStationsCache'

export async function GET(request: Request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (!rateLimit(`aemet:${ip}`, 30)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }

  if (!process.env.AEMET_API_KEY) {
    return NextResponse.json(
      { error: 'AEMET API key not configured. Add AEMET_API_KEY to .env.local', stations: [] },
      { status: 200 }
    )
  }

  const { searchParams } = new URL(request.url)
  const lat = searchParams.get('lat')
  const lon = searchParams.get('lon')
  // El acotado (antes `?radius=1e9` devolvía las ~900 estaciones de
  // golpe) vive ahora en `parametrosSeleccion`, junto con el mínimo por
  // conteo, para que las dos rutas de estaciones lo hagan igual.
  const { radiusKm: radius, minCount } = parametrosSeleccion(searchParams)

  // Sprint 10 / B-10-5 (E6): consult the shared Turso cache first so a
  // cold lambda in serverless deployments doesn't burn the upstream
  // AEMET quota just to warm up. The in-process memo remains as the
  // innermost, fastest layer.
  const fresh = await getFreshCachedStations('aemet')
  let stations = fresh
    ? parseStationsPayload<AemetRaw[]>(fresh)
    : null
  let fetchedAt = fresh?.fetchedAt ?? null

  if (!stations) {
    try {
      stations = await fetchAemetStations()
      fetchedAt = Date.now()
      void setCachedStations('aemet', JSON.stringify(stations), fetchedAt).catch(err => {
        console.warn('[aemet] cache write failed', err)
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[aemet] ${message}`)
      // Sprint 10: try the shared stale cache first, then the in-process
      // memo. Order matters: the shared cache survives cold starts.
      const stale = await getStaleCachedStations('aemet')
      const staleStations = stale ? parseStationsPayload<AemetRaw[]>(stale) : null
      if (stale && staleStations) {
        stations = staleStations
        fetchedAt = stale.fetchedAt
      } else {
        const memoStations = getStaleAemetStations()
        if (memoStations) {
          stations = memoStations
          fetchedAt = null
        } else {
          return NextResponse.json(
            // Sin `detail` del proveedor: AEMET lleva la API key en el
            // query string, asi que cualquier mensaje suyo que incluya la
            // URL la filtraria al cliente.
            { error: 'Failed to fetch AEMET data' },
            { status: 502 }
          )
        }
      }
    }
  }

  // Selección por cercanía EN EL SERVIDOR: dentro del radio, o las N más
  // cercanas si el radio no alcanza el mínimo. Al cliente se le manda ya
  // el conjunto final —un puñado de estaciones, no las ~900— y ordenado
  // por distancia, que es lo que espera el nowcast.
  //
  // La descarga completa desde AEMET es inevitable: su API no admite
  // consulta por radio. Por eso se cachea el volcado entero y el recorte
  // se hace aquí; pedirlo por radio en cada petición sería PEOR, no
  // mejor, porque multiplicaría las llamadas contra su cuota.
  const filtered =
    lat && lon
      ? seleccionarEstaciones(stations, [Number(lat), Number(lon)], {
          radiusKm: radius,
          minCount,
          // AEMET publica UNA OBSERVACIÓN POR HORA por estación, así que
          // sin colapsar por `idema` "las 5 más cercanas" devolvía 5
          // lecturas del mismo sitio en vez de 5 estaciones. Y llegan en
          // orden ascendente: quedarse con la primera era quedarse con la
          // MÁS ANTIGUA.
          idDe: s => s.idema,
          frescuraDe: s => Date.parse(s.fint),
        })
      : stations

  return NextResponse.json(
    {
      stations: filtered,
      fetchedAt: fetchedAt ? new Date(fetchedAt).toISOString() : new Date().toISOString(),
    },
    { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' } }
  )
}
