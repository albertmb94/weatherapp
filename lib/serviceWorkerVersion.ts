/**
 * Identidad de despliegue para el Service Worker.
 *
 * DOS BUGS QUE ESTO ARREGLA (auditoría):
 *
 *  1. La versión era `sha1(public/sw.js)`. Ese fichero es una PLANTILLA
 *     estática: sólo cambia cuando alguien edita el propio Service
 *     Worker. En un despliegue normal el hash era idéntico, `activate`
 *     no borraba ninguna caché (filtra por `!k.startsWith(VERSION)`) y
 *     los usuarios seguían con los assets viejos indefinidamente. La
 *     promesa de la cabecera de `public/sw.js` —"a new deployment
 *     purges the previous cache deterministically"— era simplemente
 *     falsa.
 *
 *  2. El valor se cacheaba en `node_modules/.cache/weather/`. Los
 *     proveedores de CI restauran `node_modules` entre builds, así que
 *     ese fichero podía sobrevivir a un despliegue y devolver la versión
 *     ANTERIOR — justo el fallo que pretendía evitar. La caché se ha
 *     eliminado: leer una variable de entorno o un fichero de 40 bytes
 *     no necesita optimización, y la ruta que lo consume es
 *     `force-static`.
 *
 * El docstring anterior además atribuía a `next.config.ts` la escritura
 * del fichero de caché; `next.config.ts` no contiene ese código.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Identidad estable y única por despliegue, en orden de preferencia. */
function computeVersion(): string {
  // 1. Vercel: el SHA del commit es determinista y disponible tanto en
  //    build como en runtime.
  const sha = process.env.VERCEL_GIT_COMMIT_SHA
  if (sha && sha.length >= 7) return `weather-${sha.slice(0, 12)}`

  // 2. Vercel sin git (deploy por CLI o subida directa).
  const deploymentId = process.env.VERCEL_DEPLOYMENT_ID
  if (deploymentId) return `weather-${deploymentId.slice(-12)}`

  // 3. Self-hosted: el BUILD_ID de Next cambia en cada `next build`.
  try {
    const buildId = readFileSync(join(process.cwd(), '.next', 'BUILD_ID'), 'utf-8').trim()
    if (buildId) return `weather-${buildId.slice(0, 12)}`
  } catch {
    /* sin build (modo dev) */
  }

  // 4. Último recurso: el hash de la plantilla. Es lo que había antes y
  //    NO distingue despliegues, pero al menos cambia si se edita el SW.
  try {
    const template = readFileSync(join(process.cwd(), 'public', 'sw.js'), 'utf-8')
    return `weather-tpl-${createHash('sha1').update(template).digest('hex').slice(0, 12)}`
  } catch {
    return 'weather-unknown'
  }
}

export const SW_VERSION = computeVersion()

// SW_FALLBACK se ha eliminado: el respaldo vivía en el cliente y la
// sustitución global de la ruta lo hacía ganar SIEMPRE (ver public/sw.js).
// `computeVersion()` ya garantiza un valor con sentido en los cuatro
// escenarios, así que no hay nada que respaldar.
