import { NextResponse } from 'next/server'
import { handleBacktestRequest } from '@/lib/backtest/runWeeklyBacktest'
import { ensureBacktestSchema, getModelAccuracy } from '@/lib/backtest/db'

/**
 * Backtest trigger is locked behind:
 *   1. POST only (GET cannot run anything; it may still read accuracy).
 *   2. A shared secret presented as `Authorization: Bearer ${BACKTEST_SECRET}`.
 *      The secret is read from the server environment, never sent to the
 *      browser. No secret → the endpoint returns 503 so misconfigured
 *      deployments fail closed.
 *
 * `action=migrate` from GET (which used to run DDL) is removed; schema
 * initialisation must run during deploy, not from an unauthenticated HTTP
 * endpoint.
 */

function authed(request: Request): boolean {
  const expected = process.env.BACKTEST_SECRET
  if (!expected || expected.length < 16) return false
  const header = request.headers.get('authorization') ?? ''
  if (!header.startsWith('Bearer ')) return false
  const token = header.slice('Bearer '.length).trim()
  if (token.length === 0 || token.length > 256) return false
  // Constant-time compare; tokens are short, so this is overkill but
  // cheap and prevents timing leaks.
  let mismatch = token.length === expected.length ? 0 : 1
  for (let i = 0; i < Math.min(token.length, expected.length); i++) {
    mismatch |= token.charCodeAt(i) ^ expected.charCodeAt(i)
  }
  return mismatch === 0
}

export async function GET(request: Request) {
  if (!authed(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { searchParams } = new URL(request.url)
  const action = searchParams.get('action')

  if (action === 'accuracy') {
    const lat = Number(searchParams.get('lat') ?? '0')
    const lon = Number(searchParams.get('lon') ?? '0')
    const terrain = searchParams.get('terrain') ?? 'global'
    const metric = searchParams.get('metric') ?? 'temperature'
    const bucket = searchParams.get('bucket') ?? '0-24h'

    try {
      await ensureBacktestSchema()
      const records = await getModelAccuracy(lat, lon, terrain, metric, bucket)
      return NextResponse.json({ success: true, records, timestamp: new Date().toISOString() })
    } catch (err) {
      // Se descartaba sin dejar rastro: un 500 aquí no daba ninguna pista
      // de por qué. Al cliente se le sigue sin contar nada.
      console.error('[backtest] accuracy falló:', err instanceof Error ? err.message : err)
      return NextResponse.json({ success: false, error: 'accuracy failed' }, { status: 500 })
    }
  }

  return NextResponse.json({ error: 'Unsupported GET action' }, { status: 400 })
}

export async function POST(request: Request) {
  if (!authed(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return handleBacktestRequest()
}
