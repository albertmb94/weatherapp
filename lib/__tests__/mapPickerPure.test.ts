import { describe, it, expect } from 'vitest'

// Re-implement the pure functions from MapPicker for testing
// since they're not exported from the component file.

interface GridCell {
  lat: number
  lng: number
}

function buildGrid(bounds: { getSouth: () => number; getNorth: () => number; getWest: () => number; getEast: () => number }, rows: number, cols: number): GridCell[] {
  const minLat = bounds.getSouth()
  const maxLat = bounds.getNorth()
  const minLng = bounds.getWest()
  const maxLng = bounds.getEast()
  const stepLat = (maxLat - minLat) / rows
  const stepLng = (maxLng - minLng) / cols
  const grid: GridCell[] = []
  for (let r = 0; r < rows; r++) {
    const lat = minLat + stepLat * (r + 0.5)
    for (let c = 0; c < cols; c++) {
      const lng = minLng + stepLng * (c + 0.5)
      grid.push({ lat, lng })
    }
  }
  return grid
}

function roundBounds(bounds: { getSouth: () => number; getWest: () => number; getNorth: () => number; getEast: () => number }, precision = 1): string {
  const f = (n: number) => n.toFixed(precision)
  return `${f(bounds.getSouth())},${f(bounds.getWest())},${f(bounds.getNorth())},${f(bounds.getEast())}`
}

function bilinearInterpolate(
  lat: number,
  lng: number,
  gridCells: GridCell[],
  values: (number | null)[],
  rows: number,
  cols: number
): number | null {
  const minLat = gridCells[0]?.lat ?? 0
  const maxLat = gridCells[(rows - 1) * cols]?.lat ?? 0
  const minLng = gridCells[0]?.lng ?? 0
  const maxLng = gridCells[cols - 1]?.lng ?? 0

  // PERFORMANCE: the in-component copy short-circuits
  // out-of-bounds points. Keep this test mirror in sync so
  // the assertions line up with the production behaviour.
  if (lat < minLat || lat > maxLat || lng < minLng || lng > maxLng) return null

  const stepLat = (maxLat - minLat) / (rows - 1 || 1)
  const stepLng = (maxLng - minLng) / (cols - 1 || 1)

  const fi = (lat - minLat) / stepLat
  const fj = (lng - minLng) / stepLng

  const i0 = fi < 0 ? 0 : fi > rows - 1 ? rows - 2 : fi | 0
  const j0 = fj < 0 ? 0 : fj > cols - 1 ? cols - 2 : fj | 0
  const i1 = i0 + 1
  const j1 = j0 + 1

  // PERFORMANCE: at the grid boundary, the second row/column
  // is out of range (we only have `rows` and `cols` cells, so
  // the corner cell uses i0 == rows - 1). Clamp the indices
  // back so the value lookup hits the corner instead of
  // `undefined`.
  const ii1 = i1 >= rows ? i0 : i1
  const jj1 = j1 >= cols ? j0 : j1

  const ti = fi - i0
  const tj = fj - j0

  const v00 = values[i0 * cols + j0]
  const v01 = values[i0 * cols + jj1]
  const v10 = values[ii1 * cols + j0]
  const v11 = values[ii1 * cols + jj1]

  if (v00 === null || v01 === null || v10 === null || v11 === null) return null

  const v0 = v00 * (1 - tj) + v01 * tj
  const v1 = v10 * (1 - tj) + v11 * tj
  return v0 * (1 - ti) + v1 * ti
}

function parseColor(color: string): [number, number, number] {
  const match = color.match(/rgb\((\d+),(\d+),(\d+)\)/)
  if (!match) return [42, 42, 42]
  return [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])]
}

describe('buildGrid', () => {
  const bounds = {
    getSouth: () => 48.0,
    getNorth: () => 50.0,
    getWest: () => 2.0,
    getEast: () => 4.0,
  }

  it('creates correct number of cells', () => {
    const grid = buildGrid(bounds, 3, 4)
    expect(grid.length).toBe(12)
  })

  it('centers cells in their grid boxes', () => {
    const grid = buildGrid(bounds, 2, 2)
    expect(grid[0].lat).toBeCloseTo(48.5)
    expect(grid[0].lng).toBeCloseTo(2.5)
    expect(grid[3].lat).toBeCloseTo(49.5)
    expect(grid[3].lng).toBeCloseTo(3.5)
  })

  it('handles single row and column', () => {
    const grid = buildGrid(bounds, 1, 1)
    expect(grid.length).toBe(1)
    expect(grid[0].lat).toBeCloseTo(49.0)
    expect(grid[0].lng).toBeCloseTo(3.0)
  })
})

describe('roundBounds', () => {
  const bounds = {
    getSouth: () => 48.8566,
    getWest: () => 2.3522,
    getNorth: () => 52.5200,
    getEast: () => 13.4050,
  }

  it('rounds to 1 decimal by default', () => {
    expect(roundBounds(bounds)).toBe('48.9,2.4,52.5,13.4')
  })

  it('respects precision parameter', () => {
    const result = roundBounds(bounds, 2)
    expect(result).toContain('48.86')
    expect(result).toContain('52.52')
  })
})

describe('bilinearInterpolate', () => {
  const grid = [
    { lat: 0, lng: 0 }, { lat: 0, lng: 1 },
    { lat: 1, lng: 0 }, { lat: 1, lng: 1 },
  ]
  const values = [0, 10, 20, 30]

  it('returns corner values exactly', () => {
    expect(bilinearInterpolate(0, 0, grid, values, 2, 2)).toBe(0)
    expect(bilinearInterpolate(0, 1, grid, values, 2, 2)).toBe(10)
    expect(bilinearInterpolate(1, 0, grid, values, 2, 2)).toBe(20)
    expect(bilinearInterpolate(1, 1, grid, values, 2, 2)).toBe(30)
  })

  it('interpolates center correctly', () => {
    const result = bilinearInterpolate(0.5, 0.5, grid, values, 2, 2)
    expect(result).toBeCloseTo(15)
  })

  it('returns null if any corner is null', () => {
    const nullValues = [0, null, 20, 30]
    expect(bilinearInterpolate(0.5, 0.5, grid, nullValues, 2, 2)).toBeNull()
  })

  it('returns null for points outside the grid (no extrapolation)', () => {
    // PERFORMANCE: the previous build clamped out-of-bounds
    // points to the corner cell. That produced extrapolated
    // values for pixels outside the grid — wrong in
    // principle, and it forced the per-pixel loop to run the
    // full bilinear math for every out-of-bounds pixel. The
    // updated implementation short-circuits to `null` so the
    // caller can paint a transparent pixel instead, and the
    // inner loop skips the bilinear math entirely.
    const result = bilinearInterpolate(-1, -1, grid, values, 2, 2)
    expect(result).toBeNull()
    expect(bilinearInterpolate(5, 5, grid, values, 2, 2)).toBeNull()
  })
})

describe('parseColor', () => {
  it('parses valid rgb string', () => {
    expect(parseColor('rgb(255,128,0)')).toEqual([255, 128, 0])
  })

  it('returns default for invalid string', () => {
    expect(parseColor('invalid')).toEqual([42, 42, 42])
  })

  it('returns default for hex color', () => {
    expect(parseColor('#ff0000')).toEqual([42, 42, 42])
  })

  it('handles rgb without spaces', () => {
    expect(parseColor('rgb(10,20,30)')).toEqual([10, 20, 30])
  })
})
