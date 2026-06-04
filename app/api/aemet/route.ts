import { NextResponse } from 'next/server'
import { fetchAemetStations, fetchAemetStation } from '@/lib/aemet'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const station = searchParams.get('station')

  if (!process.env.AEMET_API_KEY) {
    return NextResponse.json(
      { error: 'AEMET API key not configured. Add AEMET_API_KEY to .env.local', stations: [] },
      { status: 200 }
    )
  }

  try {
    let stations
    if (station && /^[A-Za-z0-9]+$/.test(station)) {
      stations = await fetchAemetStation(station)
    } else {
      stations = await fetchAemetStations()
    }
    return NextResponse.json(
      { stations, fetchedAt: new Date().toISOString() },
      { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' } }
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[aemet] ${station ?? 'all'}: ${message}`)
    return NextResponse.json(
      { error: 'Failed to fetch AEMET data', detail: message },
      { status: 502 }
    )
  }
}
