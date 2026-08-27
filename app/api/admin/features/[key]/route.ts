import { NextRequest, NextResponse } from 'next/server'
import { getCurrentAdmin } from '@/lib/admin/auth'
import { db } from '@/lib/db'
import { ensureFeatureFlagsSchema, maskSecretConfig, revalidateFeature } from '@/lib/features'
import { safeDecode } from '@/lib/api/params'

/** Admin read of a single flag. Returns `config` with secret values
 *  masked (''), so the FeatureConfigForm can seed its fields without
 *  ever echoing real secrets back into the DOM. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const admin = await getCurrentAdmin()
  if (!admin) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  const { key } = await params
  const decodedKey = safeDecode(key)
  if (decodedKey === null) {
    return NextResponse.json({ ok: false, error: 'malformed_key' }, { status: 400 })
  }
  try {
    const rows = await db.select<{ enabled: number | string; config: string | null; description: string | null }>(
      'SELECT enabled, config, description FROM feature_flags WHERE key = ?',
      [decodedKey],
    )
    if (!rows[0]) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })
    let config: Record<string, unknown> = {}
    if (rows[0].config) {
      try {
        config = JSON.parse(rows[0].config)
      } catch {
        console.error('[features] config corrupto para', decodedKey)
      }
    }
    return NextResponse.json({
      ok: true,
      feature: {
        key: decodedKey,
        enabled: Number(rows[0].enabled) === 1,
        config: maskSecretConfig(config),
        description: rows[0].description,
      },
    })
  } catch (err) {
    console.error('[features] GET fallido para', decodedKey, err)
    return NextResponse.json({ ok: false, error: 'lookup_failed' }, { status: 500 })
  }
}

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

  // El writer también garantiza el schema (el reader lo hace en cada
  // lookup): sin esto, el primer PUT sobre una DB recién creada 500a.
  if (!(await ensureFeatureFlagsSchema())) {
    return NextResponse.json({ ok: false, error: 'db_unavailable' }, { status: 503 })
  }

  try {
    const enabled = body.enabled === true ? 1 : 0

    // B-NBT-18: al hacer merge del config, los campos con valor ''
    // se omiten para no sobrescribir secretos existentes con vacíos.
    const incomingConfig = body.config ?? {}
    const existingRow = await db.select<{ config: string | null }>(
      'SELECT config FROM feature_flags WHERE key = ?',
      [decodedKey],
    )
    let existingConfig: Record<string, unknown> = {}
    if (existingRow[0]?.config) {
      try {
        existingConfig = JSON.parse(existingRow[0].config as string)
      } catch {
        console.error('[features] config corrupto para', decodedKey, '— se reemplaza')
      }
    }
    const mergedConfig: Record<string, unknown> = { ...existingConfig }
    for (const [k, v] of Object.entries(incomingConfig)) {
      if (v === '' || v === null || v === undefined) continue // preservar secreto existente
      mergedConfig[k] = v
    }

    await db.execute(
      `INSERT INTO feature_flags (key, enabled, config, description, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         enabled = excluded.enabled,
         config = excluded.config,
         description = COALESCE(excluded.description, feature_flags.description),
         updated_at = excluded.updated_at,
         updated_by = excluded.updated_by`,
      [decodedKey, enabled, JSON.stringify(mergedConfig), body.description ?? null, Date.now(), admin],
    )
    revalidateFeature(decodedKey)
    return NextResponse.json({ ok: true })
  } catch (err) {
    // Sin String(err): no filtrar detalles internos al cliente.
    console.error('[features] PUT fallido para', decodedKey, err)
    return NextResponse.json({ ok: false, error: 'update_failed' }, { status: 500 })
  }
}
