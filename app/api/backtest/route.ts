import { NextResponse } from 'next/server'
import { handleBacktestRequest } from '@/lib/backtest/runWeeklyBacktest'
import { rateLimit } from '@/lib/rateLimit'

export async function GET(request: Request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (!rateLimit(`backtest:${ip}`, 5)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }

  return handleBacktestRequest(request)
}

export async function POST(request: Request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (!rateLimit(`backtest:${ip}`, 5)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }

  return handleBacktestRequest(request)
}
