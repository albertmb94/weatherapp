import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest'

describe('UTC archive persistence in real SQLite', () => {
  let archive: typeof import('../db')
  let db: NonNullable<ReturnType<typeof import('@/lib/db').getDb>>
  beforeAll(async () => {
    vi.stubEnv('TURSO_DATABASE_URL', 'file::memory:')
    vi.resetModules()
    db = (await import('@/lib/db')).getDb()!
    archive = await import('../db')
    await archive.ensureBacktestSchema()
  })
  afterAll(() => { db?.close(); vi.unstubAllEnvs() })

  it('stores model identity, UTC valid hour and reference offset without changes', async () => {
    const row = { model_id: 'ecmwf_ifs', lat: 41, lon: 2, metric: 'temperature',
      init_time: '2026-10-24T01:00:00.000Z', valid_time: '2026-10-25T01:00:00.000Z',
      lead_time_hours: 24, predicted_value: 15 }
    await archive.insertForecastArchive([row])
    await archive.insertForecastArchive([{ ...row, predicted_value: 16 }])
    const rows = await archive.getStationForecastArchive(41, 2, 'temperature', '2026-10-25T00:00Z', '2026-10-25T23:59Z')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ ...row, predicted_value: 16 })
    await expect(archive.insertForecastArchive([{ ...row, valid_time: '2026-10-25T01:00' }])).rejects.toThrow('Invalid UTC')
    await expect(archive.insertForecastArchive([{ ...row, lead_time_hours: 48 }])).rejects.toThrow('Invalid UTC')
  })

  it('migrates the verification version and divides bias by each model sample count', async () => {
    const columns = await db.execute('PRAGMA table_info(model_accuracy)')
    expect(columns.rows.some(r => r.name === 'verification_version')).toBe(true)
    const base = { lat: 41, lon: 2, metric: 'temperature', terrain_type: 'coastal', lead_time_bucket: '0-24h',
      mae: 1, rmse: 2, window_start: '2026-11-01', window_end: '2026-11-02', computed_at: new Date().toISOString(), verification_version: 2 }
    await archive.insertModelAccuracy([
      { ...base, model_id: 'a', bias: 2, sample_count: 10 },
      { ...base, model_id: 'b', bias: 4, sample_count: 20 },
      { ...base, model_id: 'legacy', bias: 100, sample_count: 1000, verification_version: 1 },
    ])
    const table = await archive.getBiasByTerrain('coastal', ['temperature'], ['0-24h'])
    expect(table.temperature['0-48h']).toEqual({ a: 2, b: 4 })
  })
})
