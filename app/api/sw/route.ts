import { type NextRequest } from 'next/server'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SW_VERSION } from '@/lib/serviceWorkerVersion'

/**
 * Serve the Service Worker template with the build-time version stamp
 * substituted in. Reads `public/sw.js`, replaces the two placeholders
 * (`__SW_BUILD_ID__` and `__SW_BUILD_ID_FALLBACK__`) with the values
 * computed by `lib/serviceWorkerVersion.ts`, and serves the resulting
 * source with `Cache-Control: no-store` so the browser always sees
 * the latest version.
 *
 * Without this endpoint the SW was hard-coded with
 * `weather-2026-07-19` and had to be bumped by hand on every deploy,
 * leaving clients on a stale offline cache until they purged it.
 *
 * POR QUE `force-static` (y por que NO es una contradiccion con
 * `no-store`): el handler lee `public/sw.js` del disco, y en un
 * despliegue serverless la carpeta `public/` la sirve el CDN — no forma
 * parte del bundle de la funcion. `force-static` hace que este handler
 * se ejecute EN EL BUILD, donde el fichero si existe, y lo que se
 * despliega es el resultado ya sustituido. `no-store` es una cabecera
 * para el NAVEGADOR: evita que se quede con un service worker viejo.
 * Uno es cuando se genera; la otra, quien puede guardarlo.
 *
 * La consecuencia de este acoplamiento: si alguien quita
 * `force-static`, el handler pasara a ejecutarse en tiempo de peticion,
 * `readFileSync` fallara y el service worker dejara de actualizarse. De
 * ahi el 500 explicito de abajo en vez de una excepcion sin manejar.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-static'

export function GET(_req: NextRequest): Response {
  const filePath = join(process.cwd(), 'public', 'sw.js')
  let source: string
  try {
    source = readFileSync(filePath, 'utf-8')
  } catch (err) {
    // Degradar en vez de reventar el build/handler si el fichero falta.
    console.error('[sw] no se pudo leer public/sw.js:', err instanceof Error ? err.message : err)
    return new Response('Service worker not found', {
      status: 500,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }
  // Una unica sustitucion. Antes habia dos y la primera, al ser global,
  // pisaba el marcador que usaba la logica de respaldo del propio SW
  // (ver el comentario en public/sw.js).
  const body = source.replace(/__SW_BUILD_ID__/g, SW_VERSION)
  return new Response(body, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
      'Service-Worker-Allowed': '/',
    },
  })
}
