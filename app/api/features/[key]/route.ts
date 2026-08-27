import { NextRequest, NextResponse } from 'next/server'
import { getFeature } from '@/lib/features'
import { safeDecode } from '@/lib/api/params'

/** Public, cached endpoint returning the state of a single feature
 *  flag. The client-side `useFeature` hook calls this every 30s. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params
  const decoded = safeDecode(key)
  if (decoded === null) {
    return NextResponse.json({ error: 'Malformed key' }, { status: 400 })
  }
  const feature = await getFeature(decoded)
  return NextResponse.json(feature, {
    headers: {
      'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
    },
  })
}
