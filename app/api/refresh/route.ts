import { NextResponse } from 'next/server'
import { getRefreshStatus, recordRefresh } from '@/lib/appState'

export async function GET() {
  try {
    const status = await getRefreshStatus()
    return NextResponse.json(status)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown'
    return NextResponse.json({ error: 'Failed to read refresh status', detail: message }, { status: 500 })
  }
}

export async function POST() {
  try {
    const now = Date.now()
    const status = await getRefreshStatus(now)
    if (!status.canRefresh) {
      return NextResponse.json(
        { skipped: true, reason: 'cooldown', ...status },
        { status: 200 }
      )
    }
    const refreshedAt = await recordRefresh(now)
    return NextResponse.json({ skipped: false, refreshedAt })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown'
    return NextResponse.json({ error: 'Failed to refresh', detail: message }, { status: 500 })
  }
}
