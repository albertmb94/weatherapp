import { describe, it, expect } from 'vitest'
import { buildRadarTileUrl } from '../rainViewer'

describe('buildRadarTileUrl', () => {
  const host = 'https://tilecache.rainviewer.com'
  const path = '/v2/radar/1234567890'

  it('builds default tile URL', () => {
    const url = buildRadarTileUrl(host, path)
    expect(url).toBe(`${host}${path}/256/{z}/{x}/{y}/2/1_1.png`)
  })

  it('respects size option', () => {
    const url = buildRadarTileUrl(host, path, { size: 512 })
    expect(url).toContain('/512/')
  })

  it('respects color option', () => {
    const url = buildRadarTileUrl(host, path, { color: 1 })
    expect(url).toContain('/1/')
  })

  it('respects smooth option', () => {
    const url = buildRadarTileUrl(host, path, { smooth: 0 })
    expect(url).toContain('0_1.png')
  })

  it('respects snow option', () => {
    const url = buildRadarTileUrl(host, path, { snow: 0 })
    expect(url).toContain('1_0.png')
  })

  it('combines all options', () => {
    const url = buildRadarTileUrl(host, path, { size: 512, color: 3, smooth: 0, snow: 0 })
    expect(url).toBe(`${host}${path}/512/{z}/{x}/{y}/3/0_0.png`)
  })

  it('handles empty options', () => {
    const url = buildRadarTileUrl(host, path, {})
    expect(url).toBe(`${host}${path}/256/{z}/{x}/{y}/2/1_1.png`)
  })
})
