import { NextRequest, NextResponse } from 'next/server'
import { createHash, randomBytes } from 'crypto'
import { db } from '@/lib/db'
import { migrationsReady } from '@/lib/migrations'
import { rateLimit } from '@/lib/rateLimit'
import { isTrackingAllowed, CONSENT_COOKIE } from '@/lib/trackingConsent'
import { resolveSession, SESSION_TTL_MS } from '@/lib/analytics/session'
import { dayKey } from '@/lib/analytics/time'
import { isNonPagePath, parseAcceptLanguage, parseCountry } from '@/lib/analytics/requestSignals'
import { touchVisitorIdentity } from '@/lib/analytics'

/**
 * Ingesta de analytics.
 *
 * Sustituye a /api/track/pageview y /api/track/events. Dos caminos de
 * confianza que NUNCA se mezclan:
 *
 *   (a) beacon del navegador → la identidad sale de `req.cookies`, que
 *       el navegador adjunta sola por ser same-origin. El cliente no
 *       puede falsificarla. (La ruta antigua aceptaba `x-anon-id` de
 *       quien fuera: cualquiera podía inventar visitantes y fechar
 *       visitas en el pasado.)
 *   (b) bootstrap del proxy Edge → cabeceras firmadas con
 *       TRACK_INTERNAL_SECRET, porque un `fetch` servidor-a-servidor no
 *       lleva cookies.
 *
 * Se llama /api/ingest y no /api/track/* a propósito: EasyPrivacy y
 * listas similares traen reglas genéricas para rutas que contienen
 * "track" o "analytics". Aun así hay que contar con un 10-25% de
 * infracontaje por bloqueadores — frente al ~0% de datos actuales es una
 * mejora, pero conviene saberlo antes de comparar con Plausible.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ANON_COOKIE = 'wthr_anon'
const SESSION_COOKIE = 'wthr_session'
const SESSION_SEEN_COOKIE = 'wthr_session_seen'

const MAX_BODY_BYTES = 4000
const MAX_PATH = 300
const MAX_REFERRER = 500
const MAX_UTM = 128
const MAX_ID_LEN = 128
const MAX_UA_FIELD = 64
const MAX_EVENT_NAME = 64
const MAX_PROPERTIES_BYTES = 2000

interface IngestBody {
  k?: string
  cid?: string
  t?: number
  p?: string
  q?: { lat?: number; lon?: number }
  view?: string
  r?: string
  u?: { s?: string; m?: string; c?: string }
  d?: number
  n?: string
  props?: Record<string, unknown>
  src?: string
  // Sólo del bootstrap del proxy (no hay JS que los calcule en cliente).
  device?: string
  browser?: string
  os?: string
}

function clamp(v: unknown, max: number): string | null {
  if (typeof v !== 'string' || v.length === 0) return null
  return v.slice(0, max)
}

function newIdHex(bytes: number): string {
  return randomBytes(bytes).toString('hex')
}

/**
 * Id de fila determinista a partir del `cid` del cliente Y del anon_id
 * que conoce el SERVIDOR.
 *
 * Que el hash incluya el anon_id no es decorativo: si se usara el `cid`
 * crudo como clave primaria, un cliente malicioso podría reservar ids
 * por adelantado y hacer que los `INSERT OR IGNORE` de OTROS visitantes
 * se descartaran en silencio. Así cada quien sólo puede colisionar
 * consigo mismo.
 */
function rowId(anonId: string, cid: string): string {
  return createHash('sha256').update(`${anonId}:${cid}`).digest('hex').slice(0, 32)
}

function cookieBase() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  }
}

export async function POST(req: NextRequest) {
  // El esquema ya no se crea aquí: se espera a la MISMA promesa
  // memoizada que arranca instrumentation.ts.
  const migrations = await migrationsReady()
  if (!migrations.ok) {
    return NextResponse.json({ ok: false, reason: 'schema_unavailable' }, { status: 503 })
  }

  const internalSecret = process.env.TRACK_INTERNAL_SECRET
  const presented = req.headers.get('x-track-secret')
  const isInternal = Boolean(internalSecret) && presented === internalSecret

  // --- identidad ---
  let anonId: string | null
  let prevSessionId: string | null
  let lastSeen: number
  let mintCookies = false

  if (isInternal) {
    anonId = clamp(req.headers.get('x-anon-id'), MAX_ID_LEN)
    prevSessionId = clamp(req.headers.get('x-session-id'), MAX_ID_LEN)
    lastSeen = Number(req.headers.get('x-session-seen') ?? '0')
  } else {
    // Camino del navegador: SÓLO cookies. Una cabecera x-anon-id
    // presentada por un cliente se ignora por completo.
    const consent = req.cookies.get(CONSENT_COOKIE)?.value
    if (!isTrackingAllowed(consent)) {
      // 204 y no 403: no es un error del cliente, es que no hay permiso.
      return new NextResponse(null, { status: 204 })
    }
    anonId = clamp(req.cookies.get(ANON_COOKIE)?.value, MAX_ID_LEN)
    prevSessionId = clamp(req.cookies.get(SESSION_COOKIE)?.value, MAX_ID_LEN)
    lastSeen = Number(req.cookies.get(SESSION_SEEN_COOKIE)?.value ?? '0')
    if (!anonId) {
      // Acaba de aceptar y todavía no ha vuelto a pasar por el proxy:
      // acuñamos identidad aquí mismo para no perder la primera visita
      // tras el consentimiento.
      anonId = newIdHex(16)
      mintCookies = true
    }
  }

  if (!anonId) {
    return NextResponse.json({ ok: false, reason: 'no_identity' }, { status: 400 })
  }

  // --- rate limit POR DISPOSITIVO ---
  // La ruta antigua indexaba por `x-forwarded-for`, que el fetch interno
  // del proxy no enviaba nunca: el bucket quedaba en la cadena 'unknown'
  // y TODO el sitio compartía un único cupo de 120/min, con los excesos
  // devueltos como 429 y tragados por un `.catch(() => {})`. Con la clave
  // por anon_id, un dispositivo abusivo no puede dejar sin cuota al resto.
  if (!rateLimit(`ingest:${anonId}`, 60)) {
    return NextResponse.json({ ok: false, reason: 'rate_limited' }, { status: 429 })
  }

  // --- cuerpo ---
  const raw = await req.text()
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false, reason: 'too_large' }, { status: 413 })
  }
  let body: IngestBody
  try {
    body = JSON.parse(raw) as IngestBody
  } catch {
    return NextResponse.json({ ok: false, reason: 'invalid_body' }, { status: 400 })
  }

  const cid = clamp(body.cid, 64)
  if (!cid) return NextResponse.json({ ok: false, reason: 'no_cid' }, { status: 400 })

  const now = Date.now()
  // El `ts` del cliente se acepta sólo como corrección menor de reloj.
  // La ruta antigua confiaba en él sin límite, así que se podían fechar
  // visitas en cualquier punto del pasado o del futuro.
  const clientTs = typeof body.t === 'number' && Number.isFinite(body.t) ? body.t : now
  const ts = Math.abs(clientTs - now) > 5 * 60_000 ? now : clientTs

  // --- sesión ---
  const { sessionId, isNew: isNewSession } = resolveSession(
    prevSessionId,
    lastSeen,
    now,
    () => newIdHex(12),
  )

  const res = NextResponse.json({ ok: true })
  if (!isInternal) {
    const base = cookieBase()
    if (mintCookies) {
      res.cookies.set(ANON_COOKIE, anonId, { ...base, maxAge: 60 * 60 * 24 * 730 })
    }
    // Cookie de sesión DESLIZANTE de 30 min, alineada con SESSION_TTL_MS.
    // Antes era de 24 h y se re-emitía en cada petición, lo que la hacía
    // eterna para cualquier visitante activo.
    res.cookies.set(SESSION_COOKIE, sessionId, { ...base, maxAge: SESSION_TTL_MS / 1000 })
    res.cookies.set(SESSION_SEEN_COOKIE, String(now), { ...base, maxAge: SESSION_TTL_MS / 1000 })
  }

  const kind = body.k === 'ev' ? 'ev' : 'pv'

  try {
    if (kind === 'ev') {
      await writeEvent(anonId, sessionId, cid, ts, body)
    } else {
      await writePageview(req, anonId, sessionId, isNewSession, cid, ts, body)
    }
  } catch (err) {
    console.error('[ingest] escritura fallida:', err instanceof Error ? err.message : err)
    // Sin detalles del SQL al cliente.
    return NextResponse.json({ ok: false, reason: 'write_failed' }, { status: 500 })
  }

  return res
}

async function writePageview(
  req: NextRequest,
  anonId: string,
  sessionId: string,
  isNewSession: boolean,
  cid: string,
  ts: number,
  body: IngestBody,
): Promise<void> {
  const pathname = (clamp(body.p, MAX_PATH) ?? '/').split('?')[0]
  if (isNonPagePath(pathname)) return

  const day = dayKey(ts)
  const lat = body.q?.lat
  const lon = body.q?.lon
  const geoCell =
    typeof lat === 'number' && typeof lon === 'number' &&
    Number.isFinite(lat) && Number.isFinite(lon) &&
    Math.abs(lat) <= 90 && Math.abs(lon) <= 180
      ? `${lat.toFixed(2)},${lon.toFixed(2)}`
      : null

  // País REAL, de la geolocalización del edge. La columna `country`
  // guardaba en realidad el subtag de idioma ('en-US' → 'EN'), así que
  // el desglose "Idioma/país" del panel eran idiomas disfrazados.
  const countryCode = parseCountry(req.headers.get('x-vercel-ip-country'))
  // El proxy manda `x-track-locale` porque su fetch servidor-a-servidor
  // no hereda cabeceras; un beacon de navegador, en cambio, SÍ lleva su
  // `accept-language`. Sin este segundo camino la columna `locale` sólo
  // se habría rellenado en la fila de arranque de sesión y el desglose
  // por idioma habría salido casi vacío. (En el código anterior se
  // escribía literalmente `null` siempre.)
  const locale =
    clamp(req.headers.get('x-track-locale'), MAX_UA_FIELD) ??
    parseAcceptLanguage(req.headers.get('accept-language'))

  const duration =
    typeof body.d === 'number' && Number.isFinite(body.d) && body.d > 0
      ? Math.min(Math.round(body.d), 30 * 60_000)
      : null

  await db.executeOrThrow(
    `INSERT OR IGNORE INTO page_views
       (id, anon_id, path, referrer, utm_source, utm_medium, utm_campaign,
        country, country_code, locale, user_agent_browser, user_agent_os,
        device_type, ts, day, duration_ms, session_id, geo_cell)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      rowId(anonId, cid),
      anonId,
      pathname,
      clamp(body.r, MAX_REFERRER),
      clamp(body.u?.s, MAX_UTM),
      clamp(body.u?.m, MAX_UTM),
      clamp(body.u?.c, MAX_UTM),
      // `country` se mantiene por compatibilidad con el histórico, pero
      // ya no se escribe: los valores viejos son códigos de idioma y
      // mezclarlos con países reales sería irreparable.
      null,
      countryCode,
      locale,
      clamp(body.browser, MAX_UA_FIELD),
      clamp(body.os, MAX_UA_FIELD),
      clamp(body.device, MAX_UA_FIELD),
      ts,
      day,
      duration,
      sessionId,
      geoCell,
    ],
  )

  await db.executeOrThrow(
    `INSERT INTO sessions
       (id, anon_id, started_at, started_day, last_seen_at, page_count, country, device_type, locale, entry_path)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       last_seen_at = MAX(sessions.last_seen_at, excluded.last_seen_at),
       page_count   = sessions.page_count + 1,
       exit_path    = excluded.entry_path,
       is_bounce    = 0,
       -- Un beacon que llega desordenado (reintento, red lenta) no debe
       -- mover el inicio de la sesión hacia adelante.
       started_at   = MIN(sessions.started_at, excluded.started_at)`,
    [sessionId, anonId, ts, dayKey(ts), ts, countryCode, clamp(body.device, MAX_UA_FIELD), locale, pathname],
  )

  if (isNewSession) {
    // Marca de rebote provisional: el rollup la recalcula con page_count.
    await db.executeOrThrow('UPDATE sessions SET is_bounce = 1 WHERE id = ? AND page_count <= 1', [sessionId])
  }

  // `visitor_identity` alimenta la columna lastSeen del listado de
  // usuarios del admin. Estaba VACÍA en producción pese a escribirse en
  // cada pageview: la función no arrancaba su esquema y su try/catch se
  // comía el "no such table". Ahora las migraciones garantizan la tabla.
  await touchVisitorIdentity(anonId, ts)
}

async function writeEvent(
  anonId: string,
  sessionId: string,
  cid: string,
  ts: number,
  body: IngestBody,
): Promise<void> {
  const name = clamp(body.n, MAX_EVENT_NAME)
  if (!name) return
  let props: string | null = null
  if (body.props && typeof body.props === 'object') {
    const json = JSON.stringify(body.props)
    props = json.length <= MAX_PROPERTIES_BYTES ? json : null
  }
  await db.executeOrThrow(
    `INSERT OR IGNORE INTO events (id, anon_id, session_id, name, properties, ts)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [rowId(anonId, cid), anonId, sessionId, name, props, ts],
  )
}
