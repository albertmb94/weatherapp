import { NextRequest, NextResponse } from 'next/server'
import { getCurrentAdmin } from '@/lib/admin/auth'
import { db } from '@/lib/db'
import { revalidateFeature } from '@/lib/features'
import { safeDecode } from '@/lib/api/params'

/** Update a single feature flag. Body:
 *  { enabled: boolean, config?: Record<string, unknown>, description?: string }
 *  Always upserts so the seed row stays in sync. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const admin = await getCurrentAdmin()
  if (!admin) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  const { key } = await params
  const decodedKey = safeDecode(key)
  if (decodedKey === null) {
    return NextResponse.json({ ok: false, error: 'malformed_key' }, { status: 400 })
  }
  let body: { enabled?: boolean; config?: Record<string, unknown>; description?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 })
  }
  const enabled = body.enabled === true ? 1 : 0
  const configJson = body.config ? JSON.stringify(body.config) : null
  try {
    await db.execute(
      `INSERT INTO feature_flags (key, enabled, config, description, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         enabled = excluded.enabled,
         config = excluded.config,
         description = COALESCE(excluded.description, feature_flags.description),
         updated_at = excluded.updated_at,
         updated_by = excluded.updated_by`,
      [decodedKey, enabled, configJson, body.description ?? null, Date.now(), admin],
    )
    revalidateFeature(decodedKey)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
