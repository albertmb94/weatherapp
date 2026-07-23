import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock getDb() so the tests don't need a real libSQL handle.
const executeMock = vi.fn()
vi.mock('@/lib/db', () => ({
  getDb: () => ({ execute: executeMock }),
}))

import {
  getFreshCachedStations,
  setCachedStations,
  getStaleCachedStations,
  parseStationsPayload,
} from '../externalStationsCache'

beforeEach(() => {
  executeMock.mockReset()
  // Default: the schema-bootstrap query resolves to an empty rows
  // array so every test starts from a known mock state without
  // having to chain `mockResolvedValueOnce` for the CREATE TABLE.
  executeMock.mockResolvedValue({ rows: [] })
})

describe('externalStationsCache — fresh window', () => {
  it('returns null when the cache is empty', async () => {
    // The schema bootstrap call + the read both resolve to empty rows.
    const out = await getFreshCachedStations('aemet', 1_000_000)
    expect(out).toBeNull()
  })

  it('returns the row when age < 4 h', async () => {
    executeMock.mockResolvedValueOnce({
      rows: [{ body: '{"a":1}', fetched_at: 1_000_000 - 60 * 60 * 1000 }],
    })
    const out = await getFreshCachedStations('aemet', 1_000_000)
    expect(out).not.toBeNull()
    expect(out?.body).toBe('{"a":1}')
  })

  it('returns null when age >= 4 h', async () => {
    executeMock.mockResolvedValueOnce({
      rows: [
        {
          body: '{"a":1}',
          fetched_at: 1_000_000 - 4 * 60 * 60 * 1000,
        },
      ],
    })
    const out = await getFreshCachedStations('aemet', 1_000_000)
    expect(out).toBeNull()
  })
})

describe('externalStationsCache — stale window', () => {
  it('returns the row up to 24 h', async () => {
    executeMock.mockResolvedValueOnce({
      rows: [
        {
          body: '{"a":1}',
          fetched_at: 1_000_000 - 12 * 60 * 60 * 1000,
        },
      ],
    })
    const out = await getStaleCachedStations('aemet', 1_000_000)
    expect(out).not.toBeNull()
  })

  it('returns null past 24 h', async () => {
    executeMock.mockResolvedValueOnce({
      rows: [
        {
          body: '{"a":1}',
          fetched_at: 1_000_000 - 25 * 60 * 60 * 1000,
        },
      ],
    })
    const out = await getStaleCachedStations('aemet', 1_000_000)
    expect(out).toBeNull()
  })
})

describe('externalStationsCache — write', () => {
  it('upserts via INSERT … ON CONFLICT DO UPDATE', async () => {
    await setCachedStations('meteocat', '{"stations":[]}', 12345)
    // Find the call that contains the INSERT statement.
    const insertCall = executeMock.mock.calls.find(
      c => typeof c[0]?.sql === 'string' && c[0].sql.includes('INSERT INTO')
    )
    expect(insertCall).toBeDefined()
    expect(insertCall![0].sql).toMatch(/INSERT INTO external_stations_cache/)
    expect(insertCall![0].sql).toMatch(/ON CONFLICT\(source\) DO UPDATE/)
    expect(insertCall![0].args).toEqual(['meteocat', '{"stations":[]}', 12345])
  })
})

describe('externalStationsCache — payload parsing', () => {
  it('parses valid JSON', () => {
    const out = parseStationsPayload<{ x: number }>({
      source: 'aemet',
      body: '{"x":42}',
      fetchedAt: 1,
    })
    expect(out).toEqual({ x: 42 })
  })

  it('returns null on invalid JSON', () => {
    const out = parseStationsPayload<unknown>({
      source: 'aemet',
      body: 'not-json',
      fetchedAt: 1,
    })
    expect(out).toBeNull()
  })
})
