import { describe, it, expect } from 'vitest'
import {
  consultaParamsToUrlPatch,
  findHourIndexForLocalHour,
  franjaToLocalHour,
} from '@/lib/consultaUi'
import type { ConsultaParams } from '@/lib/consulta'

function params(overrides: Partial<ConsultaParams> = {}): ConsultaParams {
  return {
    esConsultaMeteo: true,
    tema: 'temperature',
    horizonte: 'hoy',
    horizonteDias: 1,
    franja: 'todo_el_dia',
    lugar: null,
    confianza: { esConsultaMeteo: 0.9, tema: 0.8, horizonte: 0.8, franja: 0.8, lugar: null },
    ...overrides,
  }
}

describe('consultaParamsToUrlPatch', () => {
  it('maps each horizon to the smallest covering allowed range', () => {
    expect(consultaParamsToUrlPatch(params({ horizonteDias: 1 })).range).toBe(24)
    expect(consultaParamsToUrlPatch(params({ horizonteDias: 2 })).range).toBe(48)
    expect(consultaParamsToUrlPatch(params({ horizonteDias: 3 })).range).toBe(72)
    expect(consultaParamsToUrlPatch(params({ horizonteDias: 7 })).range).toBe(168)
    expect(consultaParamsToUrlPatch(params({ horizonteDias: 14 })).range).toBe(336)
  })

  it('only sets weekDays for a week or more', () => {
    expect(consultaParamsToUrlPatch(params({ horizonteDias: 3 })).weekDays).toBeUndefined()
    expect(consultaParamsToUrlPatch(params({ horizonteDias: 7 })).weekDays).toBe(7)
    expect(consultaParamsToUrlPatch(params({ horizonteDias: 14 })).weekDays).toBe(14)
  })

  it('copies the metric when the topic resolved, and omits it otherwise', () => {
    expect(consultaParamsToUrlPatch(params({ tema: 'wind_speed' })).metric).toBe('wind_speed')
    expect(consultaParamsToUrlPatch(params({ tema: null })).metric).toBeUndefined()
  })

  it('never emits a bucket (aggregation width is not an NL concept)', () => {
    expect(consultaParamsToUrlPatch(params())).not.toHaveProperty('bucket')
  })
})

describe('franjaToLocalHour', () => {
  it('maps each part of the day to a representative hour', () => {
    expect(franjaToLocalHour('por_la_manana')).toBe(9)
    expect(franjaToLocalHour('mediodia')).toBe(13)
    expect(franjaToLocalHour('tarde')).toBe(17)
    expect(franjaToLocalHour('noche')).toBe(21)
  })

  it('anchors nothing when no part of the day was given', () => {
    expect(franjaToLocalHour('todo_el_dia')).toBeNull()
  })
})

describe('findHourIndexForLocalHour', () => {
  // "UTC-fake-local" times: getUTCHours() is the location's local hour.
  const times = [
    new Date(Date.UTC(2026, 5, 9, 6)),
    new Date(Date.UTC(2026, 5, 9, 9)),
    new Date(Date.UTC(2026, 5, 9, 17)),
    new Date(Date.UTC(2026, 5, 9, 21)),
    new Date(Date.UTC(2026, 5, 10, 9)),
  ]

  it('returns the first index matching the target hour', () => {
    expect(findHourIndexForLocalHour(times, 9)).toBe(1)
    expect(findHourIndexForLocalHour(times, 17)).toBe(2)
  })

  it('returns null when the hour is absent or the input is invalid', () => {
    expect(findHourIndexForLocalHour(times, 3)).toBeNull()
    expect(findHourIndexForLocalHour(times, -1)).toBeNull()
    expect(findHourIndexForLocalHour(times, 24)).toBeNull()
    expect(findHourIndexForLocalHour(times, 9.5)).toBeNull()
    expect(findHourIndexForLocalHour([], 9)).toBeNull()
  })
})
