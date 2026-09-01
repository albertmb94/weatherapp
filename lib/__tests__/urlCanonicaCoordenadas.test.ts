import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Dos personas en la misma manzana tienen que generar la MISMA URL.
 *
 * EL FALLO QUE ESTO FIJA. El servidor redondea lat/lon a 2 decimales
 * (~1,1 km) para construir la clave de la caché de Turso, pero el CDN
 * cachea por URL CRUDA — y el cliente enviaba las coordenadas con 4
 * decimales (~11 m). Resultado: hasta ~10.000 URLs distintas por celda
 * de caché, todas devolviendo exactamente la misma fila.
 *
 * El coste no era visible por ningún lado: las respuestas eran
 * correctas y rápidas (la caché de Turso sí acertaba), pero casi
 * ninguna petición se quedaba en el CDN, así que se pagaba invocación
 * de función y lectura de base de datos por cada visita. Es la fuga de
 * coste más grande que encontró la auditoría, y no aparece en ningún
 * log de error porque no es un error.
 *
 * El contrato que se protege aquí no es "usa toFixed(2)", es
 * "coordenadas de la misma celda producen la misma URL".
 */

const urls: string[] = []

vi.mock('../fetchWithTimeout', () => ({
  fetchWithTimeout: (url: string) => {
    urls.push(url)
    // Cortamos aquí: lo que se comprueba es la URL, no la respuesta.
    return Promise.reject(new Error('cortado a propósito'))
  },
}))

/** Dos puntos separados ~30 m: misma celda de caché, misma URL. */
const A = { lat: 41.38740, lon: 2.16860 }
const B = { lat: 41.38772, lon: 2.16891 }
/** Un punto claramente en otra celda (~5 km): URL distinta. */
const LEJOS = { lat: 41.4400, lon: 2.2200 }

async function capturar(fn: () => Promise<unknown>): Promise<string> {
  urls.length = 0
  await fn().catch(() => {})
  expect(urls.length, 'no se llegó a pedir nada').toBeGreaterThan(0)
  return urls[0]
}

describe('URL canónica de coordenadas', () => {
  beforeEach(() => { urls.length = 0 })

  it('roundCoordinate deja exactamente 2 decimales', async () => {
    const { roundCoordinate } = await import('../cacheKey')
    expect(roundCoordinate(41.3874)).toBe('41.39')
    expect(roundCoordinate(2.1686)).toBe('2.17')
    expect(roundCoordinate(-0.00049)).toBe('-0.00')
    // Sin sorpresas con valores no finitos: se devuelven tal cual para
    // que la validación de la ruta los rechace con su propio mensaje.
    expect(roundCoordinate(NaN)).toBe('NaN')
  })

  it('calidad del aire: dos puntos de la misma manzana comparten URL', async () => {
    const { fetchAirQuality } = await import('../airQuality')
    const a = await capturar(() => fetchAirQuality(A.lat, A.lon))
    const b = await capturar(() => fetchAirQuality(B.lat, B.lon))
    expect(a).toBe(b)
    expect(a).toContain('latitude=41.39')
    expect(a).toContain('longitude=2.17')
  })

  it('calidad del aire: puntos de celdas distintas NO comparten URL', async () => {
    // Sin esto el test anterior pasaría aunque alguien fijara las
    // coordenadas a una constante.
    const { fetchAirQuality } = await import('../airQuality')
    const a = await capturar(() => fetchAirQuality(A.lat, A.lon))
    const lejos = await capturar(() => fetchAirQuality(LEJOS.lat, LEJOS.lon))
    expect(a).not.toBe(lejos)
  })

  it('marino: dos puntos de la misma manzana comparten URL', async () => {
    const { fetchMarine } = await import('../marine')
    const { METRICS } = await import('../models')
    const marinas = METRICS.filter(m => m.group === 'marine')
    const a = await capturar(() => fetchMarine(A.lat, A.lon, marinas, 7))
    const b = await capturar(() => fetchMarine(B.lat, B.lon, marinas, 7))
    expect(a).toBe(b)
  })
})
