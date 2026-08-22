import { NextRequest, NextResponse } from 'next/server'
import { clearAdminCookie, destroyAdminSession, ADMIN_COOKIE_NAME } from '@/lib/admin/auth'

export async function POST(req: NextRequest) {
  const token = req.cookies.get(ADMIN_COOKIE_NAME)?.value
  if (token) await destroyAdminSession(token)
  await clearAdminCookie()
  return NextResponse.json({ ok: true })
}
