/**
 * Emisor de analytics del lado del cliente.
 *
 * NO EXISTÍA NINGUNO. Un grep de `sendBeacon|/api/track|trackEvent` en
 * todo el repo devolvía exactamente un resultado: el `fetch` interno del
 * proxy. Eso, combinado con que la SPA navega con
 * `window.history.replaceState` (lib/useUrlState.ts), significaba que
 * cambiar de ciudad, de vista, de modelo o de rango generaba CERO
 * peticiones al servidor y por tanto cero pageviews. Lo único que se
 * medía eran las cargas duras del documento.
 *
 * Por qué un beacon del navegador y no seguir con el proxy:
 *
 *   - `navigator.sendBeacon` a una ruta del MISMO origen es un POST con
 *     credenciales: el navegador adjunta `wthr_anon` y `wthr_session`
 *     automáticamente, `httpOnly` incluido. No hace falta cookie espejo
 *     ni endpoint que revele el id — y además el cliente NO PUEDE
 *     falsificar su identidad, cosa que sí podía con la cabecera
 *     `x-anon-id` que aceptaba la ruta antigua.
 *   - Ve las navegaciones internas de la SPA, que el servidor no ve.
 *   - Reduce las invocaciones del Edge de una por petición a una por
 *     sesión.
 *
 * La lógica pura vive aquí para poder testearla sin navegador; el ciclo
 * de vida de React está en components/AnalyticsTracker.tsx.
 */

import { readConsentFromBrowser } from '@/lib/trackingConsent'
import { isNonPagePath } from '@/lib/analytics/requestSignals'

export const INGEST_PATH = '/api/ingest'

/** Debe superar los 300 ms de debounce de useUrlState: si no, un cambio
 *  de ciudad emitiría 2-3 pageviews mientras la URL se asienta. */
export const EMIT_DEBOUNCE_MS = 400

export const MAX_PATH = 300
export const MAX_REFERRER = 500
export const MAX_UTM = 128
export const MAX_EVENT_NAME = 64
export const MAX_PROPERTIES_BYTES = 2000

export type IngestKind = 'pv' | 'ev'

export interface IngestPayload {
  k: IngestKind
  /** Id de deduplicación generado en cliente. El servidor NO lo usa como
   *  clave primaria tal cual: lo combina con el anon_id que él conoce. */
  cid: string
  t: number
  p?: string
  q?: { lat: number; lon: number }
  view?: string
  r?: string
  u?: { s?: string; m?: string; c?: string }
  /** duration_ms de la página anterior. */
  d?: number
  n?: string
  props?: Record<string, unknown>
  src?: 'bootstrap' | 'client'
}

/** Contexto que sólo conoce la app (no está siempre en la URL). */
export interface TrackingContext {
  lat?: number
  lon?: number
  view?: string
}

let context: TrackingContext = {}

/**
 * Publica el contexto de la vista actual.
 *
 * Es necesario porque `lat`/`lon` NO siempre están en la URL:
 * `buildQuery` en lib/useUrlState.ts los omite cuando coinciden con la
 * ciudad por defecto. La ruta de ingesta antigua los rascaba del query
 * string, así que la celda geográfica salía NULL para la ciudad más
 * visitada de todas y el desglose "Zonas" del panel estaba
 * estructuralmente vacío. Aquí viajan explícitos desde el estado.
 */
export function setTrackingContext(next: TrackingContext): void {
  context = { ...context, ...next }
}

export function getTrackingContext(): TrackingContext {
  return context
}

/** Sólo para tests. */
export function resetTrackingContext(): void {
  context = {}
}

/** Celda geográfica de ~1 km. Mismo formato que usaba la ruta anterior
 *  para no partir el histórico de `page_views.geo_cell`. */
export function geoCellFrom(lat: number | undefined, lon: number | undefined): string | null {
  if (typeof lat !== 'number' || typeof lon !== 'number') return null
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null
  return `${lat.toFixed(2)},${lon.toFixed(2)}`
}

/**
 * Clave que decide si una navegación es "otra página".
 *
 * Deliberadamente NO es la URL completa: `hour`, `metric`, `bucket`,
 * `emode` y compañía cambian el query string constantemente mientras la
 * persona trastea con los controles, y contar cada uno como pageview
 * inflaría las vistas hasta volverlas inútiles. Lo que cuenta es dónde
 * está (ruta), qué mira (vista) y de qué sitio (celda).
 */
export function trackedKey(pathname: string, ctx: TrackingContext): string {
  return [pathname, ctx.view ?? '', geoCellFrom(ctx.lat, ctx.lon) ?? ''].join('|')
}

export function shouldEmit(prevKey: string | null, nextKey: string): boolean {
  return prevKey !== nextKey
}

function clamp(v: string | null | undefined, max: number): string | undefined {
  if (!v) return undefined
  const s = String(v).slice(0, max)
  return s.length > 0 ? s : undefined
}

/** El referente sólo interesa si viene de fuera: enlazar internamente no
 *  es una fuente de tráfico. */
export function externalReferrer(referrer: string, origin: string): string | undefined {
  if (!referrer) return undefined
  try {
    if (new URL(referrer).origin === origin) return undefined
  } catch {
    return undefined
  }
  return clamp(referrer, MAX_REFERRER)
}

export function buildPageviewPayload(args: {
  href: string
  origin: string
  referrer: string
  ctx: TrackingContext
  now: number
  cid: string
  durationMs?: number
}): IngestPayload | null {
  let url: URL
  try {
    url = new URL(args.href)
  } catch {
    return null
  }
  if (isNonPagePath(url.pathname)) return null

  const sp = url.searchParams
  const utm = {
    s: clamp(sp.get('utm_source'), MAX_UTM),
    m: clamp(sp.get('utm_medium'), MAX_UTM),
    c: clamp(sp.get('utm_campaign'), MAX_UTM),
  }
  const hasUtm = Boolean(utm.s || utm.m || utm.c)

  // Coordenadas: primero el contexto explícito de la app; si no lo hay,
  // se intenta con la URL (deep links compartidos).
  let lat = args.ctx.lat
  let lon = args.ctx.lon
  if (typeof lat !== 'number' || typeof lon !== 'number') {
    const uLat = Number(sp.get('lat'))
    const uLon = Number(sp.get('lon'))
    if (Number.isFinite(uLat) && Number.isFinite(uLon)) {
      lat = uLat
      lon = uLon
    }
  }
  const cell = geoCellFrom(lat, lon)

  const payload: IngestPayload = {
    k: 'pv',
    cid: args.cid,
    t: args.now,
    // Sólo el pathname: guardar el query string metía URLs kilométricas
    // en la tabla y en el panel.
    p: url.pathname.slice(0, MAX_PATH),
    src: 'client',
  }
  if (cell && typeof lat === 'number' && typeof lon === 'number') {
    payload.q = { lat: Number(lat.toFixed(4)), lon: Number(lon.toFixed(4)) }
  }
  if (args.ctx.view) payload.view = clamp(args.ctx.view, 32)
  const ref = externalReferrer(args.referrer, args.origin)
  if (ref) payload.r = ref
  if (hasUtm) payload.u = utm
  if (typeof args.durationMs === 'number' && args.durationMs > 0) {
    // Tope de 30 min: una pestaña abierta toda la noche no es "tiempo
    // en página", y sin tope envenena cualquier media.
    payload.d = Math.min(Math.round(args.durationMs), 30 * 60_000)
  }
  return payload
}

export function buildEventPayload(args: {
  name: string
  props?: Record<string, unknown>
  now: number
  cid: string
  pathname?: string
}): IngestPayload | null {
  const name = clamp(args.name, MAX_EVENT_NAME)
  if (!name) return null
  const payload: IngestPayload = {
    k: 'ev',
    cid: args.cid,
    t: args.now,
    n: name,
    src: 'client',
  }
  if (args.pathname) payload.p = args.pathname.slice(0, MAX_PATH)
  if (args.props) {
    // Se recorta aquí y NO en el servidor para no gastar ancho de banda
    // ni una invocación en algo que se va a descartar igualmente.
    const json = JSON.stringify(args.props)
    if (json.length <= MAX_PROPERTIES_BYTES) payload.props = args.props
  }
  return payload
}

// ---------------------------------------------------------------------------
// Envío
// ---------------------------------------------------------------------------

export function newCid(): string {
  try {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 24)
  } catch {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
  }
}

/**
 * Envía el payload.
 *
 * `text/plain` y no `application/json` a propósito: es uno de los tipos
 * "safelisted" de CORS, así que `sendBeacon` no necesita preflight y el
 * envío sobrevive al `pagehide`. El servidor parsea con `req.text()`.
 */
export function sendIngest(payload: IngestPayload): boolean {
  if (typeof window === 'undefined') return false
  if (readConsentFromBrowser() !== 'granted') return false
  const body = JSON.stringify(payload)
  try {
    if (typeof navigator.sendBeacon === 'function') {
      const blob = new Blob([body], { type: 'text/plain;charset=UTF-8' })
      if (navigator.sendBeacon(INGEST_PATH, blob)) return true
    }
  } catch {
    /* cae al fetch */
  }
  try {
    void fetch(INGEST_PATH, {
      method: 'POST',
      headers: { 'content-type': 'text/plain;charset=UTF-8' },
      body,
      credentials: 'same-origin',
      keepalive: true,
    }).catch(() => {})
    return true
  } catch {
    return false
  }
}

/** Emite un evento con nombre. Primer consumidor real que tiene el
 *  endpoint de eventos desde que se escribió. */
export function track(name: string, props?: Record<string, unknown>): void {
  if (typeof window === 'undefined') return
  const payload = buildEventPayload({
    name,
    props,
    now: Date.now(),
    cid: newCid(),
    pathname: window.location.pathname,
  })
  if (payload) sendIngest(payload)
}

// ---------------------------------------------------------------------------
// Parcheo del historial
// ---------------------------------------------------------------------------

export const URL_CHANGE_EVENT = 'wthr:urlchange'

interface PatchedWindow extends Window {
  __wthrHistoryPatched?: boolean
}

/**
 * `history.pushState` y `history.replaceState` NO emiten ningún evento.
 * `popstate` sólo cubre atrás/adelante. Como lib/useUrlState.ts sincroniza
 * con `replaceState`, sin este parche el emisor sería ciego a toda la
 * navegación interna — que es la inmensa mayoría del uso real de la app.
 *
 * Se parchea el prototipo una sola vez y nunca en SSR.
 */
export function patchHistory(): void {
  if (typeof window === 'undefined') return
  const w = window as PatchedWindow
  if (w.__wthrHistoryPatched) return
  w.__wthrHistoryPatched = true

  const notify = (): void => {
    // Microtarea: deja que la URL esté ya actualizada cuando se lea.
    queueMicrotask(() => window.dispatchEvent(new Event(URL_CHANGE_EVENT)))
  }
  for (const method of ['pushState', 'replaceState'] as const) {
    const original = history[method] as typeof history.pushState
    history[method] = function patched(this: History, ...args: Parameters<typeof history.pushState>) {
      const result = original.apply(this, args)
      notify()
      return result
    } as typeof history.pushState
  }
  window.addEventListener('popstate', notify)
}
