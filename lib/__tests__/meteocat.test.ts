import { describe, it, expect } from 'vitest'
import {
  XEMA_VAR,
  parseStationsMetadata,
  parseVariableReadings,
  buildMeteocatObservations,
  type StationMeta,
} from '@/lib/meteocat'

describe('parseStationsMetadata', () => {
  it('maps station code -> name/lat/lon and skips entries without coordinates', () => {
    const json = [
      { codi: 'CC', nom: 'Orís', coordenades: { latitud: 42.07, longitud: 2.23, altitud: 626 } },
      { codi: 'XX', nom: 'No coords' }, // dropped
      { nom: 'No code', coordenades: { latitud: 41, longitud: 2 } }, // dropped
    ]
    const meta = parseStationsMetadata(json)
    expect(meta.size).toBe(1)
    expect(meta.get('CC')).toEqual({ name: 'Orís', lat: 42.07, lon: 2.23 })
  })

  it('returns an empty map for non-array input', () => {
    expect(parseStationsMetadata(null).size).toBe(0)
    expect(parseStationsMetadata({}).size).toBe(0)
  })
})

describe('parseVariableReadings', () => {
  it('extracts readings per station, drops null values, and sorts chronologically', () => {
    const json = [
      {
        codi: 'CC',
        variables: [
          {
            codi: XEMA_VAR.TEMP,
            lectures: [
              { data: '2026-06-11T08:00Z', valor: 18.4 },
              { data: '2026-06-11T07:00Z', valor: 17.1 },
              { data: '2026-06-11T09:00Z', valor: null }, // dropped
            ],
          },
        ],
      },
    ]
    const map = parseVariableReadings(json)
    const cc = map.get('CC')!
    expect(cc.map(r => r.valor)).toEqual([17.1, 18.4]) // sorted by time
  })
})

describe('buildMeteocatObservations', () => {
  const meta = new Map<string, StationMeta>([
    ['CC', { name: 'Orís', lat: 42.07, lon: 2.23 }],
    ['DD', { name: 'No temp', lat: 41.0, lon: 2.0 }],
  ])

  function readings(...vals: { data: string; valor: number }[]) {
    return vals
  }

  it('builds observations, derives max/min from temp series, sums precip, converts wind m/s->km/h', () => {
    const byVar = {
      TEMP: new Map([['CC', readings(
        { data: '2026-06-11T07:00Z', valor: 15 },
        { data: '2026-06-11T08:00Z', valor: 21 },
        { data: '2026-06-11T09:00Z', valor: 19 },
      )]]),
      HUMIDITY: new Map([['CC', readings({ data: '2026-06-11T09:00Z', valor: 60 })]]),
      PRESSURE: new Map([['CC', readings({ data: '2026-06-11T09:00Z', valor: 1012 })]]),
      WIND_SPEED: new Map([['CC', readings({ data: '2026-06-11T09:00Z', valor: 10 })]]), // 10 m/s
      WIND_DIR: new Map([['CC', readings({ data: '2026-06-11T09:00Z', valor: 90 })]]),
      PRECIP: new Map([['CC', readings(
        { data: '2026-06-11T08:00Z', valor: 0.4 },
        { data: '2026-06-11T09:00Z', valor: 0.6 },
      )]]),
    }

    const obs = buildMeteocatObservations(meta, byVar)
    expect(obs).toHaveLength(1) // DD has no temp -> dropped
    const s = obs[0]
    expect(s.code).toBe('CC')
    expect(s.temperature.current).toBe(19) // last reading
    expect(s.temperature.max).toBe(21)
    expect(s.temperature.min).toBe(15)
    expect(s.humidity.current).toBe(60)
    expect(s.pressure.current).toBe(1012)
    expect(s.wind.speed).toBeCloseTo(36) // 10 m/s * 3.6
    expect(s.wind.direction).toBe('E') // 90°
    expect(s.precipitation).toBeCloseTo(1.0)
    expect(s.updatedAt).toBe('2026-06-11T09:00Z')
  })

  it('drops stations without any temperature reading', () => {
    const empty = new Map()
    const byVar = {
      TEMP: empty, HUMIDITY: empty, PRESSURE: empty,
      WIND_SPEED: empty, WIND_DIR: empty, PRECIP: empty,
    }
    expect(buildMeteocatObservations(meta, byVar)).toHaveLength(0)
  })
})
