import { NextResponse } from 'next/server'
import { handleBacktestRequest } from '@/lib/backtest/runWeeklyBacktest'
import { ensureBacktestSchema } from '@/lib/backtest/db'
import { rateLimit } from '@/lib/rateLimit'

export async function GET(request: Request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (!rateLimit(`backtest:${ip}`, 10)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }

  const { searchParams } = new URL(request.url)
  const action = searchParams.get('action')

  if (action === 'migrate') {
    try {
      await ensureBacktestSchema()
      return NextResponse.json({
        success: true,
        message: 'Backtest tables created successfully',
        timestamp: new Date().toISOString(),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return NextResponse.json({ success: false, error: message }, { status: 500 })
    }
  }

  return handleBacktestRequest(request)
}

export async function POST(request: Request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (!rateLimit(`backtest:${ip}`, 10)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }

  return handleBacktestRequest(request)
}
