import { describe, it, expect, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/serviceWorkerVersion', () => ({ SW_VERSION: 'weather-abc123def456' }))

import { GET } from '@/app/api/sw/route'

/**
 * El service worker que se sirve.
 *
 * Este fichero existe por un fallo que NO se veía leyendo el código y
 * que sólo apareció al inspeccionar producción: la sustitución de la
 * versión es un `replace(/__SW_BUILD_ID__/g, ...)` GLOBAL, y el propio
 * `sw.js` contenía ese mismo marcador dentro de una comparación:
 *
 *     const EFFECTIVE_VERSION = (SW_VERSION === '__SW_BUILD_ID__')
 *       ? `weather-dev-${FALLBACK}` : SW_VERSION
 *
 * Tras sustituir, la condición quedaba `(X === X)` — siempre cierta — y
 * el service worker usaba SIEMPRE el nombre de respaldo. Como `activate`
 * borra las cachés que no empiezan por la versión efectiva, eso
 * significaba que NINGÚN despliegue purgaba la caché anterior: el bug
 * que todo el versionado pretendía arreglar seguía intacto.
 */

async function servir(): Promise<string> {
  const res = GET(new NextRequest('https://ejemplo.test/api/sw'))
  expect(res.status).toBe(200)
  return res.text()
}

describe('GET /api/sw', () => {
  it('sustituye la versión del despliegue', async () => {
    const src = await servir()
    expect(src).toContain('weather-abc123def456')
  })

  it('NO deja ningún marcador sin sustituir', async () => {
    // Un marcador superviviente es código muerto que decide el nombre de
    // la caché: exactamente el fallo original.
    const src = await servir()
    expect(src).not.toContain('__SW_BUILD_ID__')
    expect(src).not.toContain('__SW_BUILD_ID_FALLBACK__')
  })

  it('el nombre de la caché deriva de la versión del despliegue', async () => {
    const src = await servir()
    // EFFECTIVE_VERSION debe ser la versión a secas, sin ternarios ni
    // nombres de respaldo que puedan ganarle.
    expect(src).toMatch(/const EFFECTIVE_VERSION = 'weather-abc123def456'/)
    // Se comprueba el PATRON DE CODIGO, no la cadena suelta: sw.js
    // menciona `weather-dev-` en un comentario que documenta el fallo.
    expect(src).not.toMatch(/`weather-dev-${/)
  })

  it('no reintroduce el skipWaiting incondicional', async () => {
    // Con skipWaiting + clients.claim y un activate que borra cachés, la
    // pestaña abierta pierde los chunks de su propio build: ChunkLoadError.
    const src = await servir()
    expect(src).not.toMatch(/\.then\(\(\) => self\.skipWaiting\(\)\)/)
    expect(src).toContain('SKIP_WAITING')
  })

  it('se sirve como JavaScript, sin caché y con scope raíz', async () => {
    const res = GET(new NextRequest('https://ejemplo.test/api/sw'))
    expect(res.headers.get('content-type')).toContain('javascript')
    expect(res.headers.get('cache-control')).toContain('no-store')
    // Sin esta cabecera el SW no puede controlar '/' desde '/api/sw'.
    expect(res.headers.get('service-worker-allowed')).toBe('/')
  })
})
