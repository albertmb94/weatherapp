import { describe, expect, it } from 'vitest'
import { weightedAvg } from '../ensemble'
import { aemetToStationObservation, pickClosestStation, type StationObservation } from '../nowcast'
import { computeContinuousMetrics, computePrecipitationMetrics } from '../backtest/computeMetrics'
import { bordaWeights } from '../backtest/evalEnsemble'
import { computeCurrentSnapshot } from '../friendlyForecast'
import { MODELS } from '../models'
import { weightsFor, meanAtHour } from '../ensemble/central'

describe('forecast audit regressions', () => {
  it('renormalizes only finite values with valid positive aligned weights', () => {
    expect(weightedAvg([10, NaN, Infinity, 99, 80], [2, 1, 1, -1])).toBe(10)
    expect(weightedAvg([10, 20], [0, NaN])).toBeNull()
    expect(weightedAvg([10, 20], [1, 1], { a: 0 }, ['a', 'b'])).toBe(20)
  })

  it('does not count invalid verification pairs as observations', () => {
    expect(computeContinuousMetrics([3, NaN, 5], [1, 2, Infinity])).toEqual({
      mae: 2, rmse: 2, bias: 2, sampleCount: 1,
    })
    expect(computePrecipitationMetrics([NaN, -1], [2, 0]).sampleCount).toBe(0)
  })

  it('ranks tied models equally, including perfect dry forecasts', () => {
    const rows = ['a', 'b', 'c'].map(model_id => ({ model_id, lat: 1, lon: 1, rmse: 0 }))
    const w = bordaWeights(rows)
    expect(w.a).toBe(w.b)
    expect(w.b).toBe(w.c)
    expect(bordaWeights([...rows].reverse())).toEqual(w)
  })

  it('does not rank duplicate model rows as independent models', () => {
    const rows = ['a', 'b'].map(model_id => ({ model_id, lat: 1, lon: 1, rmse: 1 }))
    expect(bordaWeights([...rows, ...rows], 3)).toEqual({})
  })

  it('adapts raw AEMET fields, UTC timestamp and wind units', () => {
    const obs = aemetToStationObservation({ idema: 'TEST', ubi: 'Station', lat: 41.45, lon: 2.25,
      fint: '2026-11-08T09:00:00', ta: 15, tamax: 18, tamin: 12, hr: 70,
      vv: 2, vmax: 4, dv: 180, prec: 2, alt: 20 })!
    expect(obs.temperatureC).toBe(15)
    expect(obs.windKmh).toBe(7.2)
    expect(obs.observedAt).toBe(Date.parse('2026-11-08T09:00:00Z'))
    expect(obs.precipitationMm).toBeNull()
  })

  it('prefers a fresh nearby station over a closer stale or invalid station', () => {
    const now = Date.parse('2026-11-08T09:00:00Z')
    const base: StationObservation = { id: 'fresh', source: 'aemet', lat: 41.451, lon: 2.25,
      observedAt: now, distanceKm: 0, temperatureC: 15, humidityPct: null,
      pressureHpa: null, windKmh: null, windDirDeg: null, precipitationMm: null }
    const stations = [
      { ...base, id: 'stale', lat: 41.45, observedAt: now - 2 * 3600_000 },
      { ...base, id: 'invalid', lat: 41.45, observedAt: NaN }, base,
    ]
    expect(pickClosestStation([{ source: 'aemet', stations }], 41.45, 2.25, now)?.id).toBe('fresh')
    expect(pickClosestStation([{ source: 'aemet', stations: [base] }], 40, 2, now)).toBeNull()
  })

  it('does not apply wind chill in calm weather', () => {
    const bag = { time: [new Date('2026-11-08T09:00Z')], series: {
      ecmwf_ifs: { temperature: [5], wind_speed: [0], humidity: [70] },
    } }
    expect(computeCurrentSnapshot(bag, MODELS, [], 0)?.feelsLikeC).toBeCloseTo(5, 10)
  })

  it('uses the selected future lead for the headline ensemble', () => {
    const models = MODELS.filter(m => ['ecmwf_ifs', 'gfs_global'].includes(m.id))
    const bag = { time: [new Date('2026-11-18T09:00Z')], series: {
      ecmwf_ifs: { temperature: [10] }, gfs_global: { temperature: [30] },
    } }
    const snapshot = computeCurrentSnapshot(bag, models, [], 0, null, null, new Set(), null, 240)
    expect(snapshot?.temperatureC).toBe(meanAtHour(bag, 'temperature', 0, models, weightsFor('temperature', 240, 1, models)))
    expect(snapshot?.temperatureC).not.toBe(computeCurrentSnapshot(bag, models, [], 0)?.temperatureC)
  })
})
