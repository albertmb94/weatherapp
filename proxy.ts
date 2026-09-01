import { NextRequest, NextResponse, type NextFetchEvent } from 'next/server'
import { CONSENT_COOKIE, isTrackingAllowed } from '@/lib/trackingConsent'
import { resolveSession, SESSION_TTL_MS } from '@/lib/analytics/session'
import {
  isBotUa,
  parseAcceptLanguage,
  parseBrowser,
  parseCountry,
  parseDevice,
  parseOS,
  shouldBootstrap,
} from '@/lib/analytics/requestSignals'
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  LOCALE_HEADER,
  internalLocalePath,
  isLocale,
  isLocaleExemptPath,
  localizedHref,
  negotiateLocale,
  splitLocale,
} from '@/lib/locale/routing'

const ANON_COOKIE = 'wthr_anon'
const SESSION_COOKIE = 'wthr_session'
const SESSION_SEEN_COOKIE = 'wthr_session_seen'
const ADMIN_COOKIE = 'wthr_admin'

/**
 * Next.js 16 proxy.ts (antes middleware.ts).
 *
 * Responsabilidades: identidad anónima + gate de consentimiento, gate
 * de /admin, cabeceras de seguridad y UN bootstrap de sesión.
 *
 * QUÉ CAMBIÓ (auditoría) y por qué:
 *
 *  1. Antes disparaba un pageview en CADA petición que casara el
 *     matcher. Ahora sólo al ABRIR sesión, y sólo si la petición parece
 *     una navegación real (ver `shouldBootstrap`). El resto de pageviews
 *     los emite el navegador con `navigator.sendBeacon`
 *     (components/AnalyticsTracker.tsx), que además ve las navegaciones
 *     internas de la SPA — invisibles para el servidor porque
 *     lib/useUrlState.ts sincroniza la URL con `history.replaceState`.
 *     Efecto colateral: muchas menos invocaciones de Edge.
 *
 *  2. El envío iba en un `void fetch(...)` suelto con `keepalive: true`.
 *     `keepalive` es una pista del FETCH DE NAVEGADOR y no significa
 *     nada en el servidor: Vercel puede congelar o terminar el worker en
 *     cuanto se devuelve la respuesta, así que la entrega era una
 *     lotería. Ahora va dentro de `event.waitUntil(...)`, que es la
 *     única forma soportada de prolongar trabajo en Edge.
 *
 *  3. El id de sesión no rotaba nunca (se calculaba `isNewSession` y se
 *     descartaba). Ahora rota de verdad vía `resolveSession`.
 *
 *  4. `country` guardaba el subtag de IDIOMA ('en-US' → 'EN'). Ahora el
 *     país sale de la geolocalización del edge y el idioma viaja aparte,
 *     con su etiqueta completa.
 *
 *  5. Se emitían `x-anon-id` / `x-session-id` como cabeceras de
 *     RESPUESTA, exponiendo el identificador pseudónimo al navegador y a
 *     cualquier intermediario, sin que nadie las consumiera. Eliminadas.
 */

/** Match every request EXCEPT static assets, internal Next endpoints
 *  and the SW. */
export const config = {
  matcher: [
    // AUDITORIA: dos añadidos.
    //  - `icon-.*\.png`: los iconos de la PWA pasaron a ser PNG,
    //    y con el patron anterior (solo .svg) el proxy se ejecutaba en
    //    cada peticion de icono. `isLocaleExemptPath` los dejaba pasar,
    //    pero el trabajo se hacia igual. Se añade tambien
    //    `apple-touch-icon.png`, que no empieza por `icon-`. Ojo: van
    //    como alternativas sueltas y no como `\.(svg|png)` porque el
    //    parser de rutas de Next lee los parentesis como grupo de
    //    captura y rechaza el patron entero en el build.
    //  - `api/client-errors`: telemetria de errores, que llega justo
    //    cuando la app esta rota y puede llegar a rafagas. No necesita
    //    nada del proxy y no debe pagarlo.
    '/((?!_next/static|_next/image|favicon.ico|icon-.*\\.svg|icon-.*\\.png|apple-touch-icon\\.png|sw\\.js|api/ingest|api/track|api/health|api/features|api/client-errors|api/affiliate/redirect).*)',
  ],
}

/** Edge-runtime-safe random byte generator. Uses Web Crypto
 *  `crypto.getRandomValues` which is available in the Edge runtime
 *  (Node's `crypto.randomBytes` is not). */
function randomBytes(size: number): Uint8Array {
  const arr = new Uint8Array(size)
  crypto.getRandomValues(arr)
  return arr
}

function toHex(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i++) {
    s += (bytes[i] ?? 0).toString(16).padStart(2, '0')
  }
  return s
}

/** Apply the project's baseline security headers to every response.
 *  Kept conservative so the existing weather app (which loads Leaflet,
 *  Open-Meteo, Plausible, etc.) keeps working. Tighten as the surface
 *  matures. */
function applySecurityHeaders(res: NextResponse): void {
  res.headers.set('X-Content-Type-Options', 'nosniff')
  res.headers.set('X-Frame-Options', 'SAMEORIGIN')
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.headers.set('Permissions-Policy', 'geolocation=(self), camera=(), microphone=()')
  // CSP report-only (auditoría F3): añadirla en modo "report" primero para
  // detectar violaciones sin romper Leaflet/Open-Meteo/Plausible. Cuando el
  // reporte esté limpio se puede pasar a enforcement.
  res.headers.set('Content-Security-Policy-Report-Only',
    "default-src 'self'; " +
    // El script de Cookiebot se carga de consent.cookiebot.com (ver
    // app/layout.tsx), no de cdn.cookiebot.com. La CSP sólo permitía el
    // segundo: hoy es report-only y no rompe nada, pero el informe sale
    // sucio y la cabecera sería incorrecta el día que se aplique.
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://plausible.io https://cdn.cookiebot.com https://consent.cookiebot.com; " +
    "style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: blob: https:; " +
    "connect-src 'self' https://api.open-meteo.com https://*.turso.io https://plausible.io https://cdn.cookiebot.com https://consent.cookiebot.com; " +
    "font-src 'self' data:; " +
    "frame-src 'self' https://www.google.com https://pagead2.googlesyndication.com; " +
    "worker-src 'self' blob:; " +
    "base-uri 'self'; form-action 'self'")
  // HSTS only when terminating TLS (production). Vercel already enforces
  // HTTPS at the edge, but the header is harmless on http://localhost.
  if (process.env.NODE_ENV === 'production') {
    // The `includeSubDomains` flag is conservative; the existing app
    // doesn't serve any other subdomain.
    res.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  }
}

/**
 * Resuelve el idioma y decide si hay que reescribir o redirigir.
 *
 * ESQUEMA (ver lib/locale/routing.ts): el español no lleva prefijo y el
 * inglés sí. Como todas las páginas viven bajo `app/[locale]/`, una
 * petición a `/premium` no casa con ninguna ruta por sí sola: se
 * REESCRIBE internamente a `/es/premium`. La URL del navegador no
 * cambia, así que los enlaces compartidos, los enlaces cortos, las URLs
 * de retorno de Stripe y el histórico de `page_views` siguen valiendo
 * exactamente igual que antes del refactor.
 */
function resolveLocaleRouting(req: NextRequest): {
  action: 'skip' | 'rewrite' | 'pass' | 'redirect'
  locale: typeof DEFAULT_LOCALE
  target?: string
} {
  const { pathname } = req.nextUrl
  if (isLocaleExemptPath(pathname)) return { action: 'skip', locale: DEFAULT_LOCALE }

  const { locale, rest } = splitLocale(pathname)

  // `/es/...` existe pero no es canónico: una sola URL por idioma.
  // Si no se redirigiera, cada página tendría dos direcciones en español
  // y Google las trataría como contenido duplicado.
  if (locale === DEFAULT_LOCALE) {
    return { action: 'redirect', locale: DEFAULT_LOCALE, target: localizedHref(rest, DEFAULT_LOCALE) }
  }

  // `/en/...` casa directamente con app/[locale].
  if (locale && isLocale(locale)) return { action: 'pass', locale }

  // --- URL sin prefijo ---
  //
  // LOS BOTS NUNCA SE REDIRIGEN. Googlebot rastrea con `Accept-Language:
  // en`, así que negociar el idioma con él le serviría siempre la versión
  // inglesa y le escondería el sitio en español — que es el principal.
  // Ve la versión por defecto y descubre la otra por los `hreflang`, que
  // es exactamente para lo que existen.
  const esBot = isBotUa(req.headers.get('user-agent') ?? '')
  if (esBot) return { action: 'rewrite', locale: DEFAULT_LOCALE }

  // 1. Elección EXPLÍCITA de la persona: manda sobre todo lo demás.
  const preferida = req.cookies.get(LOCALE_COOKIE)?.value
  if (isLocale(preferida)) {
    if (preferida === DEFAULT_LOCALE) return { action: 'rewrite', locale: DEFAULT_LOCALE }
    return { action: 'redirect', locale: preferida, target: localizedHref(rest, preferida) }
  }

  // 2. Sin elección previa: se negocia con Accept-Language. Esto
  //    reproduce el comportamiento que ya tenía la app (leía
  //    `navigator.language` en el cliente), pero ahora en el servidor y
  //    con una URL de verdad detrás, en vez de cambiando el idioma
  //    después del primer render.
  const negociado = negotiateLocale(req.headers.get('accept-language'))
  if (negociado !== DEFAULT_LOCALE) {
    return { action: 'redirect', locale: negociado, target: localizedHref(rest, negociado) }
  }

  return { action: 'rewrite', locale: DEFAULT_LOCALE }
}

export async function proxy(req: NextRequest, event: NextFetchEvent) {
  const { pathname } = req.nextUrl

  // Admin gate (deferred to route handler when DB is needed; here we just
  // guard by cookie presence to keep middleware synchronous and fast).
  if (pathname.startsWith('/admin')) {
    const token = req.cookies.get(ADMIN_COOKIE)?.value
    const isLoginPage = pathname === '/admin/login' || pathname.startsWith('/admin/login/')
    if (!token && !isLoginPage) {
      const url = req.nextUrl.clone()
      url.pathname = '/admin/login'
      const redirect = NextResponse.redirect(url)
      // Auditoría: esta respuesta salía SIN cabeceras de seguridad — sólo
      // las recibía el NextResponse.next() del final.
      applySecurityHeaders(redirect)
      return redirect
    }
    // If they have a token, the actual session validation happens in the
    // route handler (we can't await DB lookups here without breaking the
    // edge runtime contract).
  }

  const routing = resolveLocaleRouting(req)
  if (routing.action === 'redirect' && routing.target) {
    const url = req.nextUrl.clone()
    url.pathname = routing.target
    // 308: permanente y conserva el método. Los buscadores consolidan el
    // enlace en la URL canónica en vez de repartirlo entre las dos.
    const redirect = NextResponse.redirect(url, 308)
    applySecurityHeaders(redirect)
    return redirect
  }

  // B-NBT-10 (2026-08-22): consent gate. Cuando la cookie no vale
  // explícitamente 'granted' no se genera identidad ni se registra nada.
  // Ausente = aún no ha elegido = OFF.
  const trackingAllowed = isTrackingAllowed(req.cookies.get(CONSENT_COOKIE)?.value)

  // El layout raíz está POR ENCIMA del segmento [locale] y no recibe
  // params, así que el idioma le llega por cabecera de petición. Es lo
  // que permite emitir <html lang> correcto desde el servidor, que era
  // justo lo que no se podía hacer cuando el idioma vivía en
  // localStorage.
  const requestHeaders = new Headers(req.headers)
  requestHeaders.set(LOCALE_HEADER, routing.locale)

  let res: NextResponse
  if (routing.action === 'rewrite') {
    const url = req.nextUrl.clone()
    url.pathname = internalLocalePath(pathname, DEFAULT_LOCALE)
    res = NextResponse.rewrite(url, { request: { headers: requestHeaders } })
  } else {
    res = NextResponse.next({ request: { headers: requestHeaders } })
  }
  applySecurityHeaders(res)

  if (!trackingAllowed) return res

  const now = Date.now()

  // ¿Es esto una navegación real de una persona? Se calcula ANTES de
  // tocar la identidad, y no por orden estético.
  //
  // El proxy acuñaba `wthr_anon` en cuanto faltaba la cookie, sin mirar
  // qué clase de petición era. Una precarga de Next o un payload RSC
  // —que jamás se registran— acuñaban un id nuevo y lo devolvían en un
  // Set-Cookie que PISABA el que /api/ingest acababa de emitir para el
  // primer pageview tras aceptar el consentimiento. Consecuencia medida:
  // un visitante nuevo acababa con DOS identidades, contaba como dos
  // dispositivos, y la fila ya escrita quedaba atada a un id que el
  // navegador descartaba — así que en su siguiente visita volvía a
  // parecer nuevo, inflando dispositivos y hundiendo "recurrentes".
  //
  // Si no vamos a registrar nada, no se inventa identidad: se respeta la
  // que haya y punto.
  const esNavegacionReal = shouldBootstrap(req.headers, pathname)

  let anonId = req.cookies.get(ANON_COOKIE)?.value
  const isNewAnon = !anonId && esNavegacionReal
  if (!anonId && esNavegacionReal) anonId = toHex(randomBytes(16))

  const { sessionId, isNew: isNewSession } = resolveSession(
    req.cookies.get(SESSION_COOKIE)?.value,
    Number(req.cookies.get(SESSION_SEEN_COOKIE)?.value ?? '0'),
    now,
    () => toHex(randomBytes(12)),
  )

  const cookieBase = {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  } as const

  // TODA escritura de identidad va detrás de `esNavegacionReal`, y es el
  // mismo motivo para las tres cookies: una precarga de Next o un payload
  // RSC no son visitas, y aun así emitían Set-Cookie. Ese Set-Cookie
  // pisaba el que /api/ingest acababa de escribir para el primer pageview
  // tras aceptar, con dos efectos medidos en pruebas contra el navegador:
  //
  //   - identidad: el visitante acababa con DOS `anon_id` y contaba como
  //     dos dispositivos; además, la fila ya escrita quedaba atada a un id
  //     que el navegador descartaba, así que en su siguiente visita volvía
  //     a parecer nuevo (dispositivos inflados, "recurrentes" hundidos).
  //   - sesión: la sesión se rompía en dos a mitad de una visita seguida,
  //     inflando "Sesiones hoy" y falseando vistas/sesión y rebote.
  //
  // Si no vamos a registrar nada, no se toca la identidad de nadie.
  if (esNavegacionReal) {
    if (isNewAnon && anonId) {
      res.cookies.set(ANON_COOKIE, anonId, { ...cookieBase, maxAge: 60 * 60 * 24 * 730 })
    }
    // Ventana deslizante de 30 min, alineada con SESSION_TTL_MS. Antes era
    // de 24 h y se renovaba en cada petición: no caducaba nunca.
    res.cookies.set(SESSION_COOKIE, sessionId, { ...cookieBase, maxAge: SESSION_TTL_MS / 1000 })
    res.cookies.set(SESSION_SEEN_COOKIE, String(now), { ...cookieBase, maxAge: SESSION_TTL_MS / 1000 })
  }

  // Un único registro por sesión, y sólo si esto parece una navegación
  // real de una persona. Cubre a quien tenga JS desactivado o el beacon
  // bloqueado: se pierde el detalle por página, pero la sesión cuenta.
  // `anonId` puede faltar aquí: si esto no era una navegación real no se
  // acuñó identidad a propósito, y sin identidad no hay nada que
  // registrar. `esNavegacionReal` ya lo cubre, pero se comprueba también
  // para que el tipo lo refleje.
  if (isNewSession && esNavegacionReal && anonId) {
    const secret = process.env.TRACK_INTERNAL_SECRET
    if (secret) {
      const ua = req.headers.get('user-agent') ?? ''
      const url = `${req.nextUrl.origin}/api/ingest`
      const body = JSON.stringify({
        k: 'pv',
        src: 'bootstrap',
        cid: toHex(randomBytes(8)),
        t: now,
        p: pathname,
        r: req.headers.get('referer') ?? undefined,
        u: {
          s: req.nextUrl.searchParams.get('utm_source') ?? undefined,
          m: req.nextUrl.searchParams.get('utm_medium') ?? undefined,
          c: req.nextUrl.searchParams.get('utm_campaign') ?? undefined,
        },
        device: parseDevice(ua),
        browser: parseBrowser(ua),
        os: parseOS(ua),
      })
      // waitUntil: única forma soportada de que el worker Edge siga vivo
      // hasta que termine la petición saliente.
      event.waitUntil(
        fetch(url, {
          method: 'POST',
          headers: {
            'content-type': 'text/plain;charset=UTF-8',
            'x-track-secret': secret,
            'x-anon-id': anonId,
            'x-session-id': sessionId,
            'x-session-seen': String(now),
            // Se reenvían explícitamente: un fetch servidor-a-servidor no
            // hereda ninguna cabecera de la petición original, y su
            // ausencia era justo lo que colapsaba el rate limit de la
            // ruta antigua en un único bucket global de 120/min.
            'x-forwarded-for': req.headers.get('x-forwarded-for') ?? '',
            'x-vercel-ip-country': parseCountry(req.headers.get('x-vercel-ip-country')) ?? '',
            'x-track-locale': parseAcceptLanguage(req.headers.get('accept-language')) ?? '',
          },
          body,
        }).catch(() => {}),
      )
    } else if (process.env.NODE_ENV !== 'production') {
      console.warn('[proxy] TRACK_INTERNAL_SECRET sin definir: no se registra el bootstrap de sesión')
    }
  }

  return res
}
