import { NextResponse } from 'next/server'
import { saveShortLink, generateShortId } from '@/lib/shortLinks'
import { rateLimit } from '@/lib/rateLimit'

// F-9: snapshot the current URL params into a short link. The body is
// the encoded query string (without the leading "?"). The id is a
// random 8-char base36 string.
export async function POST(request: Request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (!rateLimit(`shorten:${ip}`, 10)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }
  try {
    const { params } = await request.json()
    if (typeof params !== 'string' || params.length > 2048) {
      return NextResponse.json({ error: 'Invalid params' }, { status: 400 })
    }
    // Reject anything that's not a clean query string. We use URLSearchParams
    // for parsing so the format is enforced for free.
    const sp = new URLSearchParams(params)
    const id = generateShortId()
    await saveShortLink(id, params)
    return NextResponse.json({ id, query: sp.toString() }, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'Failed to create short link' }, { status: 500 })
  }
}