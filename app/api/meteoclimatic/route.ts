import { NextResponse } from 'next/server'
import { fetchStationData } from '@/lib/meteoclimatic'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const station = searchParams.get('station')

  if (!station || !/^[A-Za-z0-9]+$/.test(station)) {
    return NextResponse.json({ error: 'Invalid station code' }, { status: 400 })
  }

  try {
    const stations = await fetchStationData(station)
    return NextResponse.json({
      stations,
      fetchedAt: new Date().toISOString(),
    })
  } catch {
    return NextResponse.json(
      { error: 'Failed to fetch Meteoclimatic data' },
      { status: 502 }
    )
  }
}
