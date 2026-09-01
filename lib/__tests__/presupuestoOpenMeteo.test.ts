import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * El presupuesto de tiempo del proxy y el `maxDuration` de la ruta tienen
 * que seguir cuadrando.
 *
 * ESTE TEST EXISTE POR DOS FALLOS OPUESTOS, los dos reales:
 *
 *  1. El presupuesto original llegaba a ~87 s (3 reintentos × 20 s más
 *     esperas, encadenables con un segundo `fetchWithRetry`). La
 *     plataforma mataba la función antes, así que el usuario recibía un
 *     504 y NUNCA se llegaba a ejecutar el fallback de caché stale que la
 *     ruta sí tiene preparado.
 *
 *  2. Al acortarlo se pasó de frenada: 8 s por intento. La petición real
 *     de la portada son ~400 KB (15 modelos × 16 días + 3 de histórico) y
 *     desde Vercel tarda bastante más que desde España. Cuando el pico
 *     superaba 8 s abortábamos NOSOTROS y la ruta devolvía 502 con el
 *     proveedor respondiendo bien. Con la ciudad ya cacheada se salvaba;
 *     con una ciudad nueva el usuario se quedaba sin datos.
 *
 * Lo que hay que preservar no es un número concreto, sino la RELACIÓN:
 * el presupuesto total tiene que caber en `maxDuration` dejando hueco
 * para servir la caché, y un intento tiene que dar tiempo de sobra a una
 * respuesta lenta pero válida.
 */

const raiz = join(__dirname, '..', '..')
const proxy = readFileSync(join(raiz, 'lib', 'api', 'openMeteoProxy.ts'), 'utf8')
const vercel = JSON.parse(readFileSync(join(raiz, 'vercel.json'), 'utf8')) as {
  functions?: Record<string, { maxDuration?: number }>
}

function constante(nombre: string): number {
  const m = proxy.match(new RegExp(`const ${nombre} = ([0-9_]+)`))
  if (!m) throw new Error(`no se encontró ${nombre} en openMeteoProxy.ts`)
  return Number(m[1].replace(/_/g, ''))
}

describe('presupuesto de tiempo contra Open-Meteo', () => {
  const porIntento = constante('REQUEST_TIMEOUT_MS')
  const total = constante('TOTAL_BUDGET_MS')
  const maxDuration = vercel.functions?.['app/api/forecast/route.ts']?.maxDuration

  it('la ruta declara un maxDuration', () => {
    // Sin él, Vercel aplica el suyo por defecto y el tope de abajo deja
    // de significar nada.
    expect(maxDuration, 'app/api/forecast/route.ts necesita maxDuration en vercel.json').toBeTypeOf(
      'number',
    )
  })

  it('el presupuesto total cabe en maxDuration con margen para servir caché', () => {
    // El margen es el motivo de existir del tope: agotar el presupuesto
    // debe dejar tiempo a leer la caché stale y responder, no morir por
    // timeout de plataforma.
    expect(total).toBeLessThanOrEqual((maxDuration as number) * 1000 - 4000)
  })

  it('un intento da tiempo a una respuesta lenta pero válida', () => {
    // Medido: el proveedor responde en 0,4-0,7 s desde España y ~2,7 s
    // desde la función. 8 s dejaba sin datos a ciudades no cacheadas.
    expect(porIntento).toBeGreaterThanOrEqual(12_000)
  })

  it('un intento no se come el presupuesto entero: tiene que caber un reintento', () => {
    expect(porIntento).toBeLessThan(total)
  })
})
