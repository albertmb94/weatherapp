import { describe, it, expect } from 'vitest'
import {
  dayKey,
  todayKey,
  dayStartMs,
  dayEndMs,
  nextDayKey,
  prevDayKey,
  rangeDayKeys,
  daysBetween,
  MS_PER_DAY,
} from '@/lib/analytics/time'

const H = 3_600_000

describe('dayKey (Europe/Madrid)', () => {
  it('en invierno (CET, +1) el día local adelanta a UTC desde las 23:00', () => {
    // 2026-01-01 22:30 UTC → 23:30 local, todavía día 1
    expect(dayKey(Date.UTC(2026, 0, 1, 22, 30))).toBe('2026-01-01')
    // 2026-01-01 23:30 UTC → 00:30 local del día 2
    expect(dayKey(Date.UTC(2026, 0, 1, 23, 30))).toBe('2026-01-02')
  })

  it('en verano (CEST, +2) adelanta desde las 22:00', () => {
    expect(dayKey(Date.UTC(2026, 5, 1, 21, 30))).toBe('2026-06-01')
    expect(dayKey(Date.UTC(2026, 5, 1, 22, 30))).toBe('2026-06-02')
  })

  it('éste es exactamente el desfase que rompía el dashboard: la medianoche UTC ya es "mañana" en Madrid', () => {
    // El código viejo agrupaba con strftime(...,'unixepoch') = UTC, así
    // que esta visita caía en el 1 de junio cuando el visitante la hizo
    // el 2 de junio a las 00:30 de su reloj.
    const visita = Date.UTC(2026, 5, 1, 22, 30)
    expect(dayKey(visita)).toBe('2026-06-02')
    expect(new Date(visita).toISOString().slice(0, 10)).toBe('2026-06-01')
  })
})

describe('dayStartMs', () => {
  it('medianoche local en invierno = 23:00 UTC del día anterior', () => {
    expect(dayStartMs('2026-01-02')).toBe(Date.UTC(2026, 0, 1, 23, 0))
  })

  it('medianoche local en verano = 22:00 UTC del día anterior', () => {
    expect(dayStartMs('2026-06-02')).toBe(Date.UTC(2026, 5, 1, 22, 0))
  })

  it('round-trip dayKey(dayStartMs(k)) === k a lo largo de todo un año', () => {
    let key = '2026-01-01'
    for (let i = 0; i < 365; i++) {
      expect(dayKey(dayStartMs(key))).toBe(key)
      key = nextDayKey(key)
    }
  })

  it('lanza con una clave inválida en vez de devolver NaN silencioso', () => {
    expect(() => dayStartMs('no-es-fecha')).toThrow()
  })
})

describe('fronteras DST 2026', () => {
  // Madrid adelanta el último domingo de marzo (29/03/2026, 02:00→03:00)
  // y atrasa el último domingo de octubre (25/10/2026, 03:00→02:00).
  it('el 29 de marzo dura 23 horas', () => {
    expect(dayEndMs('2026-03-29') - dayStartMs('2026-03-29')).toBe(23 * H)
  })

  it('el 25 de octubre dura 25 horas', () => {
    expect(dayEndMs('2026-10-25') - dayStartMs('2026-10-25')).toBe(25 * H)
  })

  it('la hora repetida del 25 de octubre pertenece al mismo día en ambas pasadas', () => {
    // 00:30 UTC = 02:30 CEST (primera pasada); 01:30 UTC = 02:30 CET (segunda)
    expect(dayKey(Date.UTC(2026, 9, 25, 0, 30))).toBe('2026-10-25')
    expect(dayKey(Date.UTC(2026, 9, 25, 1, 30))).toBe('2026-10-25')
  })

  it('nextDayKey/prevDayKey cruzan el salto sin saltarse ni repetir días', () => {
    expect(nextDayKey('2026-03-28')).toBe('2026-03-29')
    expect(nextDayKey('2026-03-29')).toBe('2026-03-30')
    expect(prevDayKey('2026-03-30')).toBe('2026-03-29')
    expect(nextDayKey('2026-10-24')).toBe('2026-10-25')
    expect(nextDayKey('2026-10-25')).toBe('2026-10-26')
    expect(prevDayKey('2026-10-26')).toBe('2026-10-25')
  })
})

describe('rangeDayKeys', () => {
  const now = Date.UTC(2026, 7, 27, 10, 0) // 27 ago 2026, 12:00 Madrid

  it('devuelve exactamente rangeDays claves, ascendentes y terminando hoy', () => {
    for (const n of [7, 30, 90]) {
      const keys = rangeDayKeys(n, now)
      expect(keys).toHaveLength(n)
      expect(keys[n - 1]).toBe(todayKey(now))
      expect([...keys].sort()).toEqual(keys)
    }
  })

  it('son contiguas (sin huecos ni duplicados)', () => {
    const keys = rangeDayKeys(30, now)
    for (let i = 1; i < keys.length; i++) {
      expect(daysBetween(keys[i - 1], keys[i])).toBe(1)
    }
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('sigue siendo contigua cruzando el cambio de hora de octubre', () => {
    const nowOct = Date.UTC(2026, 9, 27, 10, 0)
    const keys = rangeDayKeys(7, nowOct)
    expect(keys).toContain('2026-10-25')
    for (let i = 1; i < keys.length; i++) {
      expect(daysBetween(keys[i - 1], keys[i])).toBe(1)
    }
  })
})

describe('daysBetween', () => {
  it('cuenta días de calendario, no bloques de 24 h', () => {
    // Marzo tiene un día de 23 h: contar por MS_PER_DAY daría 29.96
    expect(daysBetween('2026-03-01', '2026-03-31')).toBe(30)
    expect((dayStartMs('2026-03-31') - dayStartMs('2026-03-01')) / MS_PER_DAY).not.toBe(30)
  })

  it('es negativo hacia atrás', () => {
    expect(daysBetween('2026-06-10', '2026-06-01')).toBe(-9)
  })
})
