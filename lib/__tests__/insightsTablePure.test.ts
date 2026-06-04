import { describe, it, expect } from 'vitest'
import type { BucketHours } from '@/components/InsightsTable'

function tempEmoji(t: number | null): string {
  if (t === null) return ''
  if (t <= 0) return '🥶'
  if (t >= 30) return '🥵'
  return ''
}

function bucketLabel(start: Date, bucket: BucketHours, locale: 'es' | 'en'): string {
  const today = new Date()
  const isToday = start.getFullYear() === today.getFullYear() && start.getMonth() === today.getMonth() && start.getDate() === today.getDate()
  const isTomorrow = (() => {
    const t = new Date(today)
    t.setDate(t.getDate() + 1)
    return start.getFullYear() === t.getFullYear() && start.getMonth() === t.getMonth() && start.getDate() === t.getDate()
  })()
  const DAY_NAMES: Record<string, string[]> = {
    es: ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'],
    en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  }
  const STRINGS: Record<string, { today: string; tomorrow: string }> = {
    es: { today: 'Hoy', tomorrow: 'Mañ' },
    en: { today: 'Today', tomorrow: 'Tmrw' },
  }
  const s = STRINGS[locale]
  const day = isToday ? s.today : isTomorrow ? s.tomorrow : `${DAY_NAMES[locale][start.getDay()]} ${start.getDate()}`
  if (bucket === 24) return day
  const h0 = start.getHours().toString().padStart(2, '0')
  if (bucket === 1) return `${day} ${h0}:00`
  const h1 = ((start.getHours() + bucket) % 24).toString().padStart(2, '0')
  return `${day} ${h0}–${h1}`
}

describe('tempEmoji', () => {
  it('returns cold emoji for temp <= 0', () => {
    expect(tempEmoji(0)).toBe('🥶')
    expect(tempEmoji(-5)).toBe('🥶')
  })

  it('returns hot emoji for temp >= 30', () => {
    expect(tempEmoji(30)).toBe('🥵')
    expect(tempEmoji(35)).toBe('🥵')
  })

  it('returns empty for mild temps', () => {
    expect(tempEmoji(15)).toBe('')
    expect(tempEmoji(25)).toBe('')
  })

  it('returns empty for null', () => {
    expect(tempEmoji(null)).toBe('')
  })
})

describe('bucketLabel', () => {
  it('formats 24h bucket as day name', () => {
    const today = new Date()
    const label = bucketLabel(today, 24, 'en')
    expect(label).toBe('Today')
  })

  it('formats 1h bucket with time', () => {
    const date = new Date(2025, 0, 15, 14, 0, 0)
    const label = bucketLabel(date, 1, 'en')
    expect(label).toContain('14:00')
  })

  it('formats multi-hour bucket with range', () => {
    const date = new Date(2025, 0, 15, 6, 0, 0)
    const label = bucketLabel(date, 4, 'en')
    expect(label).toContain('06')
    expect(label).toContain('10')
  })

  it('uses Spanish locale', () => {
    const today = new Date()
    const label = bucketLabel(today, 24, 'es')
    expect(label).toBe('Hoy')
  })

  it('uses day name for non-today dates', () => {
    const date = new Date(2025, 0, 15, 12, 0, 0) // Wednesday
    const label = bucketLabel(date, 24, 'en')
    expect(label).toContain('Wed')
    expect(label).toContain('15')
  })
})
