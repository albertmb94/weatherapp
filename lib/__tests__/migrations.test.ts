import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'

// Apunta el adaptador a una BD SQLite EN MEMORIA antes de que
// `lib/db.ts` construya su cliente (los imports ESM se elevan, así que
// esto tiene que ir en vi.hoisted).
vi.hoisted(() => {
  process.env.TURSO_DATABASE_URL = 'file::memory:'
  delete process.env.TURSO_AUTH_TOKEN
})

import { db } from '@/lib/db'
import {
  MIGRATIONS,
  runMigrations,
  migrationStatus,
  migrationsReady,
  resetMigrationsMemo,
  latestVersion,
  checksum,
  type Migration,
} from '@/lib/migrations'

/** Columnas que `getAdminMetrics` y la ingesta necesitan de verdad. */
const COLUMNAS_REQUERIDAS: Record<string, string[]> = {
  page_views: [
    'id', 'anon_id', 'path', 'referrer', 'utm_source', 'utm_medium', 'utm_campaign',
    'country', 'country_code', 'locale', 'user_agent_browser', 'user_agent_os',
    'device_type', 'ts', 'day', 'duration_ms', 'session_id', 'geo_cell',
  ],
  sessions: [
    'id', 'anon_id', 'started_at', 'started_day', 'last_seen_at', 'page_count',
    'country', 'device_type', 'locale', 'entry_path', 'exit_path', 'is_bounce',
  ],
  daily_anon_stats: ['date', 'anon_id', 'views', 'sessions', 'is_new'],
  daily_breakdowns: ['date', 'dim', 'label', 'views', 'devices'],
  visitor_identity: ['anon_id', 'email', 'first_seen_at', 'first_seen_day', 'last_seen_at'],
  geo_names: ['cell', 'name', 'created_at'],
  events: ['id', 'anon_id', 'session_id', 'name', 'properties', 'ts'],
}

async function columnas(tabla: string): Promise<string[]> {
  const rows = await db.selectOrThrow<{ name: string }>(`PRAGMA table_info(${tabla})`)
  return rows.map(r => String(r.name))
}

async function tablas(): Promise<string[]> {
  const rows = await db.selectOrThrow<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table'",
  )
  return rows.map(r => String(r.name))
}

describe('catálogo de migraciones', () => {
  it('las versiones son únicas y consecutivas desde 1', () => {
    const versions = MIGRATIONS.map(m => m.version)
    expect(new Set(versions).size).toBe(versions.length)
    expect([...versions].sort((a, b) => a - b)).toEqual(
      Array.from({ length: versions.length }, (_, i) => i + 1),
    )
  })

  it('cada migración define statements o apply, nunca ninguno', () => {
    for (const m of MIGRATIONS) {
      expect(Boolean(m.statements?.length) || Boolean(m.apply), `v${m.version}`).toBe(true)
    }
  })

  it('el checksum es estable y distinto entre migraciones', () => {
    for (const m of MIGRATIONS) expect(checksum(m)).toBe(checksum(m))
    const sums = MIGRATIONS.map(checksum)
    expect(new Set(sums).size).toBe(sums.length)
  })
})

describe('runMigrations contra SQLite real', () => {
  beforeAll(async () => {
    expect(await db.ensure()).toBe(true)
  })

  beforeEach(() => resetMigrationsMemo())

  it('parte de una base vacía y aplica TODAS las pendientes', async () => {
    const antes = await tablas()
    expect(antes).not.toContain('page_views')

    const res = await runMigrations()
    expect(res.ok).toBe(true)
    expect(res.error).toBeUndefined()
    expect(res.applied).toEqual(MIGRATIONS.map(m => m.version))
    expect(res.currentVersion).toBe(latestVersion())
    expect(res.pending).toEqual([])
    expect(res.drift).toEqual([])
  })

  it('crea todas las tablas con TODAS las columnas que el código consulta', async () => {
    // Éste es el test que habría evitado el incidente: el panel leía
    // page_views y sessions, pero nadie en el camino de lectura las
    // creaba nunca.
    for (const [tabla, requeridas] of Object.entries(COLUMNAS_REQUERIDAS)) {
      const cols = await columnas(tabla)
      expect(cols.length, `${tabla} no existe`).toBeGreaterThan(0)
      for (const c of requeridas) {
        expect(cols, `falta ${tabla}.${c}`).toContain(c)
      }
    }
  })

  it('es idempotente: una segunda pasada no aplica nada', async () => {
    const res = await runMigrations()
    expect(res.ok).toBe(true)
    expect(res.applied).toEqual([])
    expect(res.currentVersion).toBe(latestVersion())
  })

  it('la tercera pasada tampoco altera el esquema', async () => {
    const antes = await columnas('page_views')
    await runMigrations()
    expect(await columnas('page_views')).toEqual(antes)
  })

  it('registra una fila por migración con su checksum', async () => {
    const rows = await db.selectOrThrow<{ version: number; name: string; checksum: string }>(
      'SELECT version, name, checksum FROM schema_migrations ORDER BY version',
    )
    expect(rows).toHaveLength(MIGRATIONS.length)
    for (const m of MIGRATIONS) {
      const row = rows.find(r => Number(r.version) === m.version)
      expect(row?.name).toBe(m.name)
      expect(row?.checksum).toBe(checksum(m))
    }
  })

  it('migrationStatus refleja el estado sin aplicar nada', async () => {
    const st = await migrationStatus()
    expect(st.ok).toBe(true)
    expect(st.pending).toEqual([])
    expect(st.currentVersion).toBe(latestVersion())
    expect(st.applied).toEqual(MIGRATIONS.map(m => m.version))
  })

  it('las columnas `day` quedan pobladas para las filas históricas', async () => {
    // Simula una fila insertada por el código viejo, sin `day`.
    await db.executeOrThrow(
      `INSERT INTO page_views (id, anon_id, path, ts) VALUES ('vieja', 'anon1', '/', ?)`,
      [Date.UTC(2026, 5, 1, 10, 0)],
    )
    await db.executeOrThrow(
      `UPDATE page_views SET day = strftime('%Y-%m-%d', ts / 1000, 'unixepoch') WHERE day IS NULL`,
    )
    const rows = await db.selectOrThrow<{ day: string }>(
      `SELECT day FROM page_views WHERE id = 'vieja'`,
    )
    expect(rows[0]?.day).toBe('2026-06-01')
  })
})

describe('manejo de fallos', () => {
  beforeEach(() => resetMigrationsMemo())

  it('una migración que falla NO se registra como aplicada', async () => {
    const rota: Migration = {
      version: 999,
      name: 'rota_a_proposito',
      statements: ['CREATE TABLE bien_1 (a TEXT)', 'ESTO NO ES SQL VÁLIDO'],
    }
    MIGRATIONS.push(rota)
    try {
      const res = await runMigrations()
      expect(res.ok).toBe(false)
      expect(res.error).toBeTruthy()
      expect(res.errorKind).toBe('query_failed')

      const rows = await db.selectOrThrow<{ n: number }>(
        'SELECT COUNT(*) AS n FROM schema_migrations WHERE version = 999',
      )
      expect(Number(rows[0]?.n)).toBe(0)

      // Y como el lote es atómico, tampoco queda la tabla a medias.
      expect(await tablas()).not.toContain('bien_1')
    } finally {
      MIGRATIONS.pop()
    }
  })

  it('detecta deriva cuando cambia el SQL de una migración ya aplicada, sin tocar la BD', async () => {
    const original = MIGRATIONS[0].statements
    MIGRATIONS[0].statements = [...(original ?? []), '-- comentario nuevo que cambia el checksum']
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const res = await runMigrations()
      expect(res.ok).toBe(true) // no aborta: fallar en cerrado tumbaría el sitio
      expect(res.drift).toEqual([{ version: 1, name: 'analytics_baseline' }])
      expect(warn).toHaveBeenCalled()
      // La fila registrada conserva el checksum ORIGINAL: no se reescribe.
      const rows = await db.selectOrThrow<{ checksum: string }>(
        'SELECT checksum FROM schema_migrations WHERE version = 1',
      )
      expect(rows[0]?.checksum).not.toBe(checksum(MIGRATIONS[0]))
    } finally {
      MIGRATIONS[0].statements = original
      warn.mockRestore()
    }
  })
})

describe('migrationsReady (memo)', () => {
  beforeEach(() => resetMigrationsMemo())

  it('varios llamadores concurrentes comparten UNA sola ejecución', async () => {
    const [a, b, c] = await Promise.all([migrationsReady(), migrationsReady(), migrationsReady()])
    expect(a).toBe(b)
    expect(b).toBe(c)
    expect(a.ok).toBe(true)
  })

  it('cachea el éxito: la segunda llamada devuelve el mismo objeto', async () => {
    const first = await migrationsReady()
    const second = await migrationsReady()
    expect(second).toBe(first)
  })
})
