import { type NextRequest } from 'next/server'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SW_VERSION, SW_FALLBACK } from '@/lib/serviceWorkerVersion'

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
 */

export const runtime = 'nodejs'
export const dynamic = 'force-static'

export function GET(_req: NextRequest): Response {
  const filePath = join(process.cwd(), 'public', 'sw.js')
  const source = readFileSync(filePath, 'utf-8')
  const body = source
    .replace(/__SW_BUILD_ID__/g, SW_VERSION)
    .replace(/__SW_BUILD_ID_FALLBACK__/g, SW_FALLBACK)
  return new Response(body, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
      'Service-Worker-Allowed': '/',
    },
  })
}
