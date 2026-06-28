import { NextResponse } from 'next/server'
import { loadShortLink } from '@/lib/shortLinks'

// F-9: GET /s/[id] → 302 to /?{snapshot}. The snapshot was stored as
// the raw query string at creation time.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^[a-z0-9]{4,16}$/.test(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }
  const snapshot = await loadShortLink(id)
  if (!snapshot) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  return NextResponse.redirect(new URL(`/?${snapshot}`, _req.url), { status: 302 })
}