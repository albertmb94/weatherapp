import { NextResponse } from 'next/server'
import { fetchStationData } from '@/lib/meteoclimatic'

export const runtime = 'edge'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const station = searchParams.get('station')

  if (!station || !/^[A-Za-z0-9]+$/.test(station)) {
    return NextResponse.json({ error: 'Invalid station code' }, { status: 400 })
  }

  try {
    const stations = await fetchStationData(station)
    return NextResponse.json(
      { stations, fetchedAt: new Date().toISOString() },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=300',
        },
      }
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const status = message.includes('403') ? 403
      : message.includes('404') ? 404
      : message.includes('timeout') || message.includes('abort') ? 504
      : 502
    console.error(`[meteoclimatic] ${station}: ${message}`)
    return NextResponse.json(
      { error: 'Failed to fetch Meteoclimatic data', detail: message },
      { status }
    )
  }
}
