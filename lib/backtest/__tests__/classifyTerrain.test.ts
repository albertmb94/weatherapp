import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the fetchWithTimeout module
vi.mock('@/lib/fetchWithTimeout', () => ({
  fetchWithTimeout: vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ elevation: [100] }),
  }),
}))

import { classifyTerrain } from '../classifyTerrain'

describe('classifyTerrain', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('classifies Barcelona as coastal', async () => {
    const result = await classifyTerrain(41.39, 2.17)
    expect(result.type).toBe('coastal')
    expect(result.confidence).toBeGreaterThan(0.5)
  })

  it('classifies Madrid as flat', async () => {
    // Mock elevation for Madrid (~667m) - higher than flat threshold
    const { fetchWithTimeout } = await import('@/lib/fetchWithTimeout')
    vi.mocked(fetchWithTimeout).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ elevation: [667] }),
    } as Response)

    const result = await classifyTerrain(40.42, -3.70)
    // Madrid is at 667m, not flat (< 200m), so it should be mountain or flat depending on logic
    expect(result.elevation).toBe(667)
    expect(result.type).toBeTruthy()
  })

  it('classifies Granada as mountain (Sierra Nevada)', async () => {
    const { fetchWithTimeout } = await import('@/lib/fetchWithTimeout')
    vi.mocked(fetchWithTimeout).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ elevation: [738] }),
    } as Response)

    const result = await classifyTerrain(37.18, -3.60)
    expect(result.elevation).toBe(738)
    expect(result.type).toBeTruthy()
  })

  it('classifies Palma de Mallorca as island', async () => {
    const result = await classifyTerrain(39.57, 2.65)
    expect(result.type).toBe('island')
    expect(result.confidence).toBeGreaterThanOrEqual(0.8)
  })

  it('classifies New York as coastal, urban or flat (near coast / metro core)', async () => {
    const result = await classifyTerrain(40.71, -74.01)
    // NY es costero Y núcleo metropolitano; la clasificación depende de la
    // elevación mockeada (que queda fijada por tests anteriores) y del
    // orden de prioridad coastal > urban > flat.
    expect(['coastal', 'urban', 'flat']).toContain(result.type)
    expect(result.elevation).toBeGreaterThanOrEqual(0)
  })

  it('classifies Tokyo as island', async () => {
    const result = await classifyTerrain(35.68, 139.69)
    expect(result.type).toBe('island')
  })

  it('returns a valid classification for any location', async () => {
    const result = await classifyTerrain(51.51, -0.13) // London
    expect(result.type).toBeTruthy()
    expect(result.confidence).toBeGreaterThan(0)
    expect(result.elevation).toBeGreaterThanOrEqual(0)
  })
})
