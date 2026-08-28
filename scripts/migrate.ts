/**
 * Ejecuta las migraciones a mano: `npm run migrate`.
 *
 * Es la vía de escape para desarrollo local y para operaciones puntuales
 * (revisar en qué versión está una base de datos, forzar una migración
 * atascada). En producción las aplica `instrumentation.ts` al arrancar el
 * proceso, y se pueden inspeccionar desde /api/admin/migrate.
 *
 * Lee TURSO_DATABASE_URL / TURSO_AUTH_TOKEN del entorno; sin ellas cae a
 * `file:local.db`, igual que el resto de la app.
 */

import { runMigrations, migrationStatus, MIGRATIONS, latestVersion } from '../lib/migrations'

function tabla(rows: string[][]): string {
  const widths = rows[0].map((_, i) => Math.max(...rows.map(r => (r[i] ?? '').length)))
  return rows
    .map((r, ri) => {
      const line = r.map((c, i) => (c ?? '').padEnd(widths[i])).join('  ')
      return ri === 0 ? `${line}\n${widths.map(w => '-'.repeat(w)).join('  ')}` : line
    })
    .join('\n')
}

async function main(): Promise<void> {
  const target = process.env.TURSO_DATABASE_URL ?? 'file:local.db'
  console.log(`Base de datos: ${target.replace(/(\/\/)[^@]*@/, '$1***@')}`)

  const antes = await migrationStatus()
  if (!antes.ok) {
    console.error(`\nNo se puede leer el estado (${antes.errorKind}): ${antes.error}`)
    process.exit(1)
  }
  console.log(`Versión actual: ${antes.currentVersion} · última conocida: ${latestVersion()}`)
  if (antes.pending.length === 0) {
    console.log('Sin migraciones pendientes.')
  } else {
    console.log(`Pendientes: v${antes.pending.join(', v')}`)
  }
  if (antes.drift.length > 0) {
    console.warn(
      `\nAVISO — deriva de checksum en: ${antes.drift.map(d => `v${d.version} (${d.name})`).join(', ')}\n` +
        'El SQL de esas migraciones ha cambiado desde que se aplicaron. La base de datos NO se\n' +
        'modifica: crea una migración nueva en vez de editar una ya aplicada.',
    )
  }

  const res = await runMigrations()
  if (!res.ok) {
    console.error(`\nFALLO (${res.errorKind}): ${res.error}`)
    process.exit(1)
  }
  if (res.applied.length > 0) {
    console.log(`\nAplicadas: v${res.applied.join(', v')}`)
  }

  const filas = [['VER', 'NOMBRE', 'ESTADO']]
  const aplicadas = new Set((await migrationStatus()).applied)
  for (const m of MIGRATIONS) {
    filas.push([String(m.version), m.name, aplicadas.has(m.version) ? 'aplicada' : 'PENDIENTE'])
  }
  console.log(`\n${tabla(filas)}`)
  console.log(`\nEsquema en v${res.currentVersion}.`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
