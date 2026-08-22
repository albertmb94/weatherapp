import { NextRequest, NextResponse } from 'next/server'
import { getCurrentAdmin } from '@/lib/admin/auth'
import { listEmailLog } from '@/lib/emails'

export async function GET(req: NextRequest) {
  const admin = await getCurrentAdmin()
  if (!admin) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  const limit = Number(req.nextUrl.searchParams.get('limit') ?? '50')
  const recipient = req.nextUrl.searchParams.get('recipient') ?? undefined
  const status = req.nextUrl.searchParams.get('status') ?? undefined
  const entries = await listEmailLog({ limit, recipient, status })
  return NextResponse.json({ ok: true, entries })
}
