import { describe, it, expect } from 'vitest'

function formatAge(ageMs: number | null): string {
  if (ageMs == null) return ''
  const minutes = Math.floor(ageMs / 60000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}

describe('formatAge', () => {
  it('returns empty for null', () => {
    expect(formatAge(null)).toBe('')
  })

  it('returns "now" for less than 1 minute', () => {
    expect(formatAge(0)).toBe('now')
    expect(formatAge(30000)).toBe('now')
    expect(formatAge(59999)).toBe('now')
  })

  it('returns minutes for less than 1 hour', () => {
    expect(formatAge(60000)).toBe('1m')
    expect(formatAge(1800000)).toBe('30m')
    expect(formatAge(3540000)).toBe('59m')
  })

  it('returns hours for less than 24 hours', () => {
    expect(formatAge(3600000)).toBe('1h')
    expect(formatAge(43200000)).toBe('12h')
    expect(formatAge(82800000)).toBe('23h')
  })

  it('returns days for 24+ hours', () => {
    expect(formatAge(86400000)).toBe('1d')
    expect(formatAge(172800000)).toBe('2d')
  })
})
