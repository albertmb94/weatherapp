import { NextResponse } from 'next/server'
import { getRefreshStatus, recordRefresh } from '@/lib/appState'
import { purgeAllForecastCache } from '@/lib/forecastCache'

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
    // Wipe the forecast cache so the next GETs repopulate from Open-Meteo.
    try {
      await purgeAllForecastCache()
    } catch (err) {
      console.warn('forecast_cache purge failed', err)
    }
    return NextResponse.json({ skipped: false, refreshedAt })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown'
    return NextResponse.json({ error: 'Failed to refresh', detail: message }, { status: 500 })
  }
}
