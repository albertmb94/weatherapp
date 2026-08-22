import { NextResponse } from 'next/server'
import { getCurrentAdmin } from '@/lib/admin/auth'
import { listTemplates, seedDefaultTemplates } from '@/lib/emails'

export async function GET() {
  const admin = await getCurrentAdmin()
  if (!admin) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  await seedDefaultTemplates()
  const templates = await listTemplates()
  return NextResponse.json({ ok: true, templates })
}
