import { NextResponse } from 'next/server'
import { recordRefresh } from '@/lib/appState'

// Vercel cron calls this endpoint with `Authorization: Bearer <CRON_SECRET>`.
// Bypasses the 4h cooldown — runs unconditionally on its schedule.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  const auth = request.headers.get('authorization')

  if (secret) {
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  try {
    const refreshedAt = await recordRefresh()
    return NextResponse.json({ refreshedAt })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown'
    return NextResponse.json({ error: 'Cron refresh failed', detail: message }, { status: 500 })
  }
}
