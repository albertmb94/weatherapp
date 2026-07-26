/**
 * Tests for the terrain-wide accuracy query (Sprint 13).
 *
 * The query itself runs against the `model_accuracy` SQLite table,
 * which we don't have in the unit-test environment. The behaviour
 * we can pin here is:
 *
 *   - When no DB is available (the production-without-Turso path),
 *     the function returns an empty array rather than throwing.
 *     This is what makes the system degrade gracefully: callers
 *     treat an empty result as "no boost" and skip the profile
 *     adjustment, leaving the un-boosted ensemble in place.
 *
 *   - When the DB exists but the table is empty for the requested
 *     terrain, the function should also return []. We test this by
 *     stubbing the DB execute() to return an empty rows array.
 *
 * The DB-mocked case uses the same pattern as the other backtest
 * tests: `vi.mock('@/lib/db', ...)` to inject a fake client.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock @/lib/db so we don't need a real SQLite handle. The
// implementations of `execute()` and `getDb()` are replaced with
// stubs controlled per-test.
const executeMock = vi.fn()
vi.mock('@/lib/db', () => ({
  getDb: vi.fn(() => ({ execute: (...args: unknown[]) => executeMock(...args) })),
}))

import { getModelAccuracyByTerrain } from '../db'

describe('getModelAccuracyByTerrain', () => {
  beforeEach(() => {
    executeMock.mockReset()
  })

  it('returns an empty array when the DB is unavailable', async () => {
    // Override the module-level mock: getDb() returns null this
    // time. We do that by re-mocking the module dynamically.
    const dbModule = await import('@/lib/db')
    vi.mocked(dbModule.getDb).mockReturnValueOnce(null as unknown as never)
    const out = await getModelAccuracyByTerrain('coastal', 'temperature', '0-24h')
    expect(out).toEqual([])
  })

  it('returns an empty array when no rows match the terrain/metric/lead-time', async () => {
    executeMock.mockResolvedValueOnce({ rows: [] })
    const out = await getModelAccuracyByTerrain('urban', 'wind_speed', '24-48h')
    expect(out).toEqual([])
  })

  it('returns the rows produced by the DB in the order the query returned them', async () => {
    const rows = [
      {
        model_id: 'ecmwf_ifs',
        lat: 41.39,
        lon: 2.17,
        terrain_type: 'coastal',
        metric: 'temperature',
        lead_time_bucket: '0-24h',
        mae: 0.5,
        rmse: 0.7,
        bias: 0.1,
        sample_count: 100,
        window_start: '2026-01-01',
        window_end: '2026-04-01',
        computed_at: new Date().toISOString(),
      },
      {
        model_id: 'icon_global',
        lat: 41.39,
        lon: 2.17,
        terrain_type: 'coastal',
        metric: 'temperature',
        lead_time_bucket: '0-24h',
        mae: 0.6,
        rmse: 0.8,
        bias: 0.05,
        sample_count: 100,
        window_start: '2026-01-01',
        window_end: '2026-04-01',
        computed_at: new Date().toISOString(),
      },
    ]
    executeMock.mockResolvedValueOnce({ rows })
    const out = await getModelAccuracyByTerrain('coastal', 'temperature', '0-24h')
    expect(out).toHaveLength(2)
    expect(out[0].model_id).toBe('ecmwf_ifs')
    expect(out[1].model_id).toBe('icon_global')
  })

  it('passes the terrain, metric, lead_time and a recent cutoff to the DB', async () => {
    executeMock.mockResolvedValueOnce({ rows: [] })
    await getModelAccuracyByTerrain('mountain', 'precipitation', '48-72h')
    expect(executeMock).toHaveBeenCalledTimes(1)
    const call = executeMock.mock.calls[0][0] as { sql: string; args: unknown[] }
    expect(call.sql).toContain('terrain_type = ?')
    expect(call.sql).toContain('metric = ?')
    expect(call.sql).toContain('lead_time_bucket = ?')
    expect(call.sql).toContain('rmse IS NOT NULL')
    expect(call.sql).toContain('ORDER BY rmse ASC')
    expect(call.args[0]).toBe('mountain')
    expect(call.args[1]).toBe('precipitation')
    expect(call.args[2]).toBe('48-72h')
    // args[3] is the cutoff ISO string; we don't pin the exact
    // value (it depends on `Date.now()`), only that it parses and
    // is within the last 90 days.
    const cutoffIso = call.args[3] as string
    expect(Number.isNaN(Date.parse(cutoffIso))).toBe(false)
    const cutoffAgeDays = (Date.now() - Date.parse(cutoffIso)) / (24 * 60 * 60 * 1000)
    expect(cutoffAgeDays).toBeGreaterThan(0)
    // Allow a tiny floating-point margin so we don't flake when the
    // test happens to run on the exact 90-day boundary.
    expect(cutoffAgeDays).toBeLessThan(90 + 1e-6)
    // args[4] is the LIMIT topN — default 5.
    expect(call.args[4]).toBe(5)
  })

  it('honours the topN option when passed', async () => {
    executeMock.mockResolvedValueOnce({ rows: [] })
    await getModelAccuracyByTerrain('coastal', 'temperature', '0-24h', { topN: 2 })
    const call = executeMock.mock.calls[0][0] as { args: unknown[] }
    expect(call.args[4]).toBe(2)
  })

  it('honours the windowDays option when passed', async () => {
    executeMock.mockResolvedValueOnce({ rows: [] })
    await getModelAccuracyByTerrain('coastal', 'temperature', '0-24h', { windowDays: 30 })
    const call = executeMock.mock.calls[0][0] as { args: unknown[] }
    const cutoffIso = call.args[3] as string
    const cutoffAgeDays = (Date.now() - Date.parse(cutoffIso)) / (24 * 60 * 60 * 1000)
    expect(cutoffAgeDays).toBeLessThanOrEqual(30)
  })
})