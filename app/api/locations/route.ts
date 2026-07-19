import { NextResponse } from 'next/server'

/**
 * Saved locations used to live in a public, anonymous, IDOR-prone table.
 * Cities are now per-device (localStorage). This endpoint is kept only as
 * a stub that responds 410 Gone so any cached client request fails loudly
 * instead of leaking the old response. New behaviour is in the front-end.
 */
function gone() {
  return NextResponse.json(
    { error: 'Saved locations are per-device now. Use localStorage.' },
    { status: 410 }
  )
}

export async function GET() {
  return gone()
}

export async function POST() {
  return gone()
}

export async function DELETE() {
  return gone()
}
