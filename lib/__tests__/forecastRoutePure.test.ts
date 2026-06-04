import { describe, it, expect } from 'vitest'

function sanitizeOpenMeteoJson(raw: string): string {
  return raw
    .replace(/:\s*nan\b/gi, ': null')
    .replace(/:\s*undefined\b/g, ': null')
    .replace(/:\s*-?Infinity\b/g, ': null')
}

describe('sanitizeOpenMeteoJson', () => {
  it('replaces nan with null', () => {
    const input = '{"value": nan}'
    const result = sanitizeOpenMeteoJson(input)
    expect(JSON.parse(result).value).toBeNull()
  })

  it('replaces NaN with null', () => {
    const input = '{"value": NaN}'
    const result = sanitizeOpenMeteoJson(input)
    expect(JSON.parse(result).value).toBeNull()
  })

  it('replaces undefined with null', () => {
    const input = '{"value": undefined}'
    const result = sanitizeOpenMeteoJson(input)
    expect(JSON.parse(result).value).toBeNull()
  })

  it('replaces Infinity with null', () => {
    const input = '{"value": Infinity}'
    const result = sanitizeOpenMeteoJson(input)
    expect(JSON.parse(result).value).toBeNull()
  })

  it('replaces -Infinity with null', () => {
    const input = '{"value": -Infinity}'
    const result = sanitizeOpenMeteoJson(input)
    expect(JSON.parse(result).value).toBeNull()
  })

  it('does not replace nan inside strings', () => {
    const input = '{"name": "nan"}'
    expect(sanitizeOpenMeteoJson(input)).toBe('{"name": "nan"}')
  })

  it('handles multiple replacements', () => {
    const input = '{"a": nan, "b": undefined, "c": Infinity}'
    const result = sanitizeOpenMeteoJson(input)
    const parsed = JSON.parse(result)
    expect(parsed.a).toBeNull()
    expect(parsed.b).toBeNull()
    expect(parsed.c).toBeNull()
  })

  it('leaves valid JSON unchanged', () => {
    const input = '{"a": 1, "b": "hello", "c": null}'
    expect(sanitizeOpenMeteoJson(input)).toBe(input)
  })
})

function parseRetryAfterMs(header: string | null): number | null {
  if (!header) return null
  const MAX_RETRY_AFTER_MS = 8000
  const seconds = Number(header)
  if (Number.isFinite(seconds)) return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS)
  const dateMs = Date.parse(header)
  if (Number.isFinite(dateMs)) return Math.min(Math.max(dateMs - Date.now(), 0), MAX_RETRY_AFTER_MS)
  return null
}

describe('parseRetryAfterMs', () => {
  it('returns null for null header', () => {
    expect(parseRetryAfterMs(null)).toBeNull()
  })

  it('parses numeric seconds', () => {
    expect(parseRetryAfterMs('5')).toBe(5000)
  })

  it('caps at MAX_RETRY_AFTER_MS', () => {
    expect(parseRetryAfterMs('30')).toBe(8000)
  })

  it('parses HTTP-date header', () => {
    const futureDate = new Date(Date.now() + 3000).toUTCString()
    const result = parseRetryAfterMs(futureDate)
    expect(result).not.toBeNull()
    expect(result!).toBeGreaterThan(0)
    expect(result!).toBeLessThanOrEqual(8000)
  })

  it('returns null for invalid header', () => {
    expect(parseRetryAfterMs('invalid')).toBeNull()
  })
})
