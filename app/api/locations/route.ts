import { NextResponse } from 'next/server'
import { getSavedLocations, saveLocation, deleteLocation } from '@/lib/locations'
import { rateLimit } from '@/lib/rateLimit'

export async function GET(request: Request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (!rateLimit(`locations:${ip}`, 30)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }
  try {
    const locations = await getSavedLocations()
    return NextResponse.json(locations)
  } catch {
    return NextResponse.json({ error: 'Failed to fetch locations' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (!rateLimit(`locations:${ip}`, 30)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }
  try {
    const { name, latitude, longitude } = await request.json()
    // M10: validate types and ranges. Without this a stringified lat/lon
    // reaches the DB and later crashes the client (e.g. toFixed on a
    // string), and unbounded `name` rows are a DoS vector.
    if (typeof name !== 'string' || name.length === 0 || name.length > 200) {
      return NextResponse.json({ error: 'Invalid name (must be 1-200 chars)' }, { status: 400 })
    }
    if (typeof latitude !== 'number' || isNaN(latitude) || latitude < -90 || latitude > 90) {
      return NextResponse.json({ error: 'Invalid latitude (-90..90)' }, { status: 400 })
    }
    if (typeof longitude !== 'number' || isNaN(longitude) || longitude < -180 || longitude > 180) {
      return NextResponse.json({ error: 'Invalid longitude (-180..180)' }, { status: 400 })
    }
    const id = await saveLocation(name, latitude, longitude)
    return NextResponse.json({ id }, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'Failed to save location' }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (!rateLimit(`locations:${ip}`, 30)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
    // M10: reject non-numeric ids before they reach the SQL layer.
    if (!/^\d+$/.test(id)) {
      return NextResponse.json({ error: 'Invalid id (must be numeric)' }, { status: 400 })
    }
    await deleteLocation(Number(id))
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Failed to delete location' }, { status: 500 })
  }
}
