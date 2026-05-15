import { NextResponse } from 'next/server'
import { getSavedLocations, saveLocation, deleteLocation } from '@/lib/locations'

export async function GET() {
  try {
    const locations = await getSavedLocations()
    return NextResponse.json(locations)
  } catch {
    return NextResponse.json({ error: 'Failed to fetch locations' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const { name, latitude, longitude } = await request.json()
    if (!name || latitude == null || longitude == null) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
    }
    const id = await saveLocation(name, latitude, longitude)
    return NextResponse.json({ id }, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'Failed to save location' }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
    await deleteLocation(Number(id))
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Failed to delete location' }, { status: 500 })
  }
}
