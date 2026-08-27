/**
 * Señales derivadas de la petición HTTP (dispositivo, navegador, SO,
 * idioma, país) y la decisión de si una petición merece registrarse.
 *
 * Vive en `lib/` y no en `proxy.ts` por dos razones:
 *   1. `vitest.config.ts` sólo incluye app, components, lib y scripts.
 *      Un `proxy.test.ts` en la raíz del repo NUNCA se ejecutaría: se
 *      crearía la ilusión de cobertura sobre el fichero más delicado.
 *   2. El proxy corre en Edge y la ingesta en Node; ambos necesitan
 *      estas mismas funciones.
 */

export type DeviceType = 'mobile' | 'tablet' | 'desktop'

export function parseDevice(ua: string): DeviceType {
  const lc = ua.toLowerCase()
  if (/ipad|tablet|android(?!.*mobile)/.test(lc)) return 'tablet'
  if (/iphone|android.*mobile|mobile|blackberry|opera mini/.test(lc)) return 'mobile'
  return 'desktop'
}

export function parseBrowser(ua: string): string {
  if (/edg\//i.test(ua)) return 'Edge'
  if (/chrome\//i.test(ua) && !/chromium/i.test(ua)) return 'Chrome'
  if (/firefox\//i.test(ua)) return 'Firefox'
  if (/safari\//i.test(ua) && !/chrome/i.test(ua)) return 'Safari'
  if (/opera|opr\//i.test(ua)) return 'Opera'
  return 'Other'
}

export function parseOS(ua: string): string {
  const lc = ua.toLowerCase()
  if (/windows/.test(lc)) return 'Windows'
  if (/iphone|ipad|ipod/.test(lc)) return 'iOS'
  if (/android/.test(lc)) return 'Android'
  if (/mac os/.test(lc)) return 'macOS'
  if (/linux/.test(lc)) return 'Linux'
  return 'Other'
}

/**
 * Etiqueta de idioma con la q más alta, COMPLETA: 'es-ES', 'en-US'.
 *
 * La versión anterior hacía `tag.split('-')[0].toUpperCase()` y guardaba
 * el resultado en la columna `country`. Es decir: 'en-US' se almacenaba
 * como país "EN" y 'es-ES' como "ES". La tabla "Idioma/país" del panel
 * era un desglose de IDIOMAS disfrazado de países, y encima ambiguo,
 * porque ES/FR/IT son a la vez códigos de idioma y de país. El país real
 * (cabecera de geolocalización del edge) no se leía nunca.
 */
export function parseAcceptLanguage(header: string | null): string | null {
  if (!header) return null
  const parts = header
    .split(',')
    .map(p => {
      const [tag, q] = p.trim().split(';q=')
      return { tag: (tag ?? '').trim(), q: q ? Number(q) : 1 }
    })
    .filter(p => p.tag.length > 0 && Number.isFinite(p.q))
  if (parts.length === 0) return null
  parts.sort((a, b) => b.q - a.q)
  const tag = parts[0]?.tag ?? ''
  // '*' es comodín, no un idioma.
  if (!tag || tag === '*') return null
  return tag.slice(0, 35)
}

/** Código ISO de país de 2 letras, validado. Vercel lo inyecta como
 *  `x-vercel-ip-country`; en local no existe y devolvemos null. */
export function parseCountry(header: string | null): string | null {
  if (!header) return null
  const v = header.trim().toUpperCase()
  return /^[A-Z]{2}$/.test(v) ? v : null
}

const BOT_RE =
  /bot|crawler|spider|crawling|slurp|facebookexternalhit|preview|headless|lighthouse|pingdom|uptime|curl|wget|python-requests|axios|go-http-client|semrush|ahrefs|dataprovider|phantomjs/i

export function isBotUa(ua: string): boolean {
  if (!ua) return true // sin user-agent = casi siempre automatizado
  return BOT_RE.test(ua)
}

/** Rutas que no son "páginas" y nunca deben generar un registro. */
export function isNonPagePath(pathname: string): boolean {
  return (
    pathname.startsWith('/api/') ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/icon-') ||
    pathname === '/manifest.json' ||
    pathname === '/sw.js' ||
    pathname === '/favicon.ico' ||
    pathname === '/robots.txt' ||
    pathname === '/sitemap.xml'
  )
}

/**
 * Es esta petición una navegación real de una persona, digna de abrir
 * sesión?
 *
 * El proxy disparaba un pageview en CADA petición que casaba el matcher,
 * sin filtrar nada: los prefetch de Link (que Next dispara al pasar el
 * ratón por encima), las cargas de payload RSC, los rastreadores y hasta
 * las llamadas a /api/* (que la ruta de ingesta descartaba después, tras
 * haber gastado ya una invocación). Resultado: dispositivos únicos
 * inflados por cada user-agent de bot, y "Páginas más vistas"
 * contaminado con el propio tráfico del panel de admin.
 */
export function shouldBootstrap(h: Headers, pathname: string): boolean {
  if (isNonPagePath(pathname)) return false
  // El panel de admin no es tráfico de producto.
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return false

  // Prefetch de Next: el usuario no ha abierto nada.
  if (h.get('next-router-prefetch') === '1') return false
  if (h.get('purpose') === 'prefetch' || h.get('x-purpose') === 'prefetch') return false
  if ((h.get('sec-purpose') ?? '').includes('prefetch')) return false
  // Payload RSC de una navegación cliente: eso ya lo cuenta el beacon.
  if (h.get('rsc') === '1') return false

  // Sólo navegaciones de documento. Las cabeceras Sec-Fetch existen en
  // todos los navegadores actuales; si faltan (cliente antiguo, o algo
  // que no es un navegador) no bloqueamos por ausencia, sólo exigimos
  // que no se contradigan.
  const dest = h.get('sec-fetch-dest')
  const mode = h.get('sec-fetch-mode')
  if (dest !== null && dest !== 'document') return false
  if (mode !== null && mode !== 'navigate') return false

  if (isBotUa(h.get('user-agent') ?? '')) return false
  return true
}
