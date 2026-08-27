/**
 * Build-time constants for the Service Worker.
 *
 * `next.config.ts` writes these values into a JSON file that lives
 * under `node_modules/.cache/weather/` so production builds don't
 * pay the runtime cost of recomputing them per request. The location
 * is deliberately outside the bundle so client code can never
 * accidentally pull it in.
 *
 * The values are:
 *   - `version` — a short hash of `public/sw.js`, used to bust the
 *     offline cache after a deploy.
 *   - `fallback` — a development-only stamp (`YYYY-MM-DD.dev`) the
 *     SW substitutes when the hash is unavailable.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

const CACHE_FILE = join(process.cwd(), 'node_modules', '.cache', 'weather', 'sw-version.json')
const SW_TEMPLATE = join(process.cwd(), 'public', 'sw.js')

interface SWConstants {
  version: string
  fallback: string
}

function compute(): SWConstants {
  try {
    const template = readFileSync(SW_TEMPLATE, 'utf-8')
    const version = createHash('sha1').update(template).digest('hex').slice(0, 12)
    const fallback = `${new Date().toISOString().slice(0, 10)}.dev`
    return { version, fallback }
  } catch {
    return { version: 'unknown', fallback: 'dev' }
  }
}

function load(): SWConstants {
  if (!existsSync(CACHE_FILE)) {
    const fresh = compute()
    try {
      mkdirSync(dirname(CACHE_FILE), { recursive: true })
      writeFileSync(CACHE_FILE, JSON.stringify(fresh))
    } catch {
      // Best-effort: if we can't write the cache file (e.g. a
      // read-only filesystem in a serverless deploy), fall back to
      // computing on the fly.
    }
    return fresh
  }
  try {
    const raw = JSON.parse(readFileSync(CACHE_FILE, 'utf-8')) as Partial<SWConstants>
    if (typeof raw.version === 'string' && typeof raw.fallback === 'string') {
      return { version: raw.version, fallback: raw.fallback }
    }
  } catch {
    // Corrupt cache; recompute on the fly.
  }
  return compute()
}

export const SW_VERSION = load().version
export const SW_FALLBACK = load().fallback
