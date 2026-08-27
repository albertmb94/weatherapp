import { NextRequest, NextResponse } from 'next/server'
import { getFeature } from '@/lib/features'
import { safeDecode } from '@/lib/api/params'

/** Public, cached endpoint returning ONLY the boolean state of a single
 *  feature flag. The client-side `useFeature` hook calls this every 30s.
 *
 *  Security: deliberately does NOT return `config` — feature configs hold
 *  secrets (Stripe secret_key, Resend/VAPID api keys). Server code reads
 *  them via `getFeatureConfig()` directly; clients only ever need
 *  `{ enabled }`. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params
  const decoded = safeDecode(key)
  if (decoded === null) {
    return NextResponse.json({ error: 'Malformed key' }, { status: 400 })
  }
  const feature = await getFeature(decoded)
  return NextResponse.json(
    { enabled: feature.enabled },
    {
      headers: {
        'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
      },
    },
  )
}
