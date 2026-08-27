import { NextResponse } from 'next/server'
import { getCurrentAdmin } from '@/lib/admin/auth'
import {
  MIGRATIONS,
  migrationStatus,
  runMigrations,
  resetMigrationsMemo,
  latestVersion,
  checksum,
} from '@/lib/migrations'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Estado y ejecución manual de las migraciones.
 *
 * En producción las aplica `instrumentation.ts` al arrancar cada
 * instancia; esta ruta existe para ver en qué versión está la base de
 * datos sin abrir una shell de Turso, y para forzar una ejecución si el
 * arranque falló (por ejemplo, si Turso estaba caída justo entonces y el
 * backoff aún no ha vencido).
 */

/** GET → qué hay aplicado, qué falta, y si hay deriva de checksum. */
export async function GET() {
  const admin = await getCurrentAdmin()
  if (!admin) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  const status = await migrationStatus()
  const catalogo = MIGRATIONS.map(m => ({
    version: m.version,
    name: m.name,
    kind: m.apply ? 'apply' : 'statements',
    statements: m.statements?.length ?? 0,
    checksum: checksum(m),
    applied: status.applied.includes(m.version),
  }))

  if (!status.ok) {
    // 503 y no 500: no es un error de programación, es que la base de
    // datos no está disponible o no está configurada en este entorno.
    return NextResponse.json(
      { ok: false, error: status.error, errorKind: status.errorKind, latestVersion: latestVersion(), catalogo },
      { status: 503 },
    )
  }

  return NextResponse.json({
    ok: true,
    currentVersion: status.currentVersion,
    latestVersion: status.latestVersion,
    pending: status.pending,
    applied: status.applied,
    drift: status.drift,
    catalogo,
  })
}

/** POST → fuerza una ejecución saltándose el memo (y su backoff). */
export async function POST() {
  const admin = await getCurrentAdmin()
  if (!admin) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  resetMigrationsMemo()
  const res = await runMigrations()
  if (!res.ok) {
    console.error(`[migrations] ejecución manual fallida (${admin}):`, res.error)
    return NextResponse.json(
      { ok: false, error: res.error, errorKind: res.errorKind },
      { status: res.errorKind === 'not_configured' ? 503 : 500 },
    )
  }
  if (res.applied.length > 0) {
    // Traza de auditoría: quién forzó un cambio de esquema y cuándo.
    // eslint-disable-next-line no-console
    console.log(`[migrations] ejecución manual por ${admin}: aplicadas v${res.applied.join(', v')}`)
  }
  return NextResponse.json({
    ok: true,
    applied: res.applied,
    currentVersion: res.currentVersion,
    latestVersion: res.latestVersion,
    drift: res.drift,
  })
}
