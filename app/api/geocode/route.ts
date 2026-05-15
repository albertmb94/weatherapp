import { NextResponse } from 'next/server'

export const revalidate = 3600

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const url = `https://geocoding-api.open-meteo.com/v1/search?${searchParams.toString()}`

  try {
    const res = await fetch(url)
    if (!res.ok) {
      return NextResponse.json({ error: 'Geocoding API error' }, { status: res.status })
    }
    const data = await res.json()
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ error: 'Failed to geocode' }, { status: 500 })
  }
}
