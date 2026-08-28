import { describe, it, expect } from 'vitest'
import {
  parseDevice,
  parseBrowser,
  parseOS,
  parseAcceptLanguage,
  parseCountry,
  isBotUa,
  isNonPagePath,
  shouldBootstrap,
} from '@/lib/analytics/requestSignals'

const UA_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
const UA_ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
const UA_IPAD =
  'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/604.1'
const UA_WIN_CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const UA_MAC_SAFARI =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'
const UA_EDGE =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0'

/** Cabeceras de una navegación de documento normal. */
function navHeaders(extra: Record<string, string> = {}): Headers {
  return new Headers({
    'user-agent': UA_WIN_CHROME,
    'sec-fetch-dest': 'document',
    'sec-fetch-mode': 'navigate',
    ...extra,
  })
}

describe('parseDevice', () => {
  it('clasifica móvil, tablet y escritorio', () => {
    expect(parseDevice(UA_IPHONE)).toBe('mobile')
    expect(parseDevice(UA_ANDROID)).toBe('mobile')
    expect(parseDevice(UA_IPAD)).toBe('tablet')
    expect(parseDevice(UA_WIN_CHROME)).toBe('desktop')
  })

  it('un Android sin "Mobile" es tablet', () => {
    expect(parseDevice('Mozilla/5.0 (Linux; Android 14; SM-X200) Chrome/120.0.0.0 Safari/537.36')).toBe('tablet')
  })
})

describe('parseBrowser / parseOS', () => {
  it('Edge no se confunde con Chrome pese a llevar "Chrome/" en el UA', () => {
    expect(parseBrowser(UA_EDGE)).toBe('Edge')
    expect(parseBrowser(UA_WIN_CHROME)).toBe('Chrome')
  })

  it('Safari no se confunde con Chrome', () => {
    expect(parseBrowser(UA_MAC_SAFARI)).toBe('Safari')
  })

  it('detecta el sistema operativo', () => {
    expect(parseOS(UA_WIN_CHROME)).toBe('Windows')
    expect(parseOS(UA_IPHONE)).toBe('iOS')
    expect(parseOS(UA_ANDROID)).toBe('Android')
    expect(parseOS(UA_MAC_SAFARI)).toBe('macOS')
    expect(parseOS('Mozilla/5.0 (X11; Linux x86_64)')).toBe('Linux')
    expect(parseOS('algo raro')).toBe('Other')
  })
})

describe('parseAcceptLanguage', () => {
  it('conserva la etiqueta COMPLETA, no sólo el idioma', () => {
    // El bug: 'en-US' se guardaba como país "EN".
    expect(parseAcceptLanguage('en-US,en;q=0.9')).toBe('en-US')
    expect(parseAcceptLanguage('es-ES,es;q=0.9,en;q=0.8')).toBe('es-ES')
  })

  it('respeta el factor q y no asume orden', () => {
    expect(parseAcceptLanguage('en;q=0.5,ca-ES;q=0.9')).toBe('ca-ES')
  })

  it('devuelve null para ausente, vacío o comodín', () => {
    expect(parseAcceptLanguage(null)).toBeNull()
    expect(parseAcceptLanguage('')).toBeNull()
    expect(parseAcceptLanguage('*')).toBeNull()
  })

  it('acota la longitud para que no envenene la columna', () => {
    expect(parseAcceptLanguage('x'.repeat(500))!.length).toBeLessThanOrEqual(35)
  })
})

describe('parseCountry', () => {
  it('acepta sólo códigos ISO de 2 letras y normaliza a mayúsculas', () => {
    expect(parseCountry('es')).toBe('ES')
    expect(parseCountry('FR')).toBe('FR')
  })

  it('rechaza basura en vez de guardarla', () => {
    expect(parseCountry(null)).toBeNull()
    expect(parseCountry('')).toBeNull()
    expect(parseCountry('ESP')).toBeNull()
    expect(parseCountry('1')).toBeNull()
  })
})

describe('isBotUa', () => {
  it('detecta rastreadores y herramientas', () => {
    expect(isBotUa('Googlebot/2.1 (+http://www.google.com/bot.html)')).toBe(true)
    expect(isBotUa('Mozilla/5.0 (compatible; bingbot/2.0)')).toBe(true)
    expect(isBotUa('curl/8.4.0')).toBe(true)
    expect(isBotUa('facebookexternalhit/1.1')).toBe(true)
    expect(isBotUa('HeadlessChrome/120.0.0.0')).toBe(true)
  })

  it('un user-agent ausente cuenta como bot', () => {
    expect(isBotUa('')).toBe(true)
  })

  it('no marca como bot a navegadores reales', () => {
    for (const ua of [UA_IPHONE, UA_ANDROID, UA_WIN_CHROME, UA_MAC_SAFARI, UA_EDGE]) {
      expect(isBotUa(ua)).toBe(false)
    }
  })
})

describe('isNonPagePath', () => {
  it('descarta rutas internas', () => {
    for (const p of ['/api/forecast', '/_next/static/x.js', '/manifest.json', '/icon-192.svg', '/sw.js', '/favicon.ico']) {
      expect(isNonPagePath(p)).toBe(true)
    }
  })

  it('deja pasar páginas reales', () => {
    for (const p of ['/', '/premium', '/manage', '/s/abc123']) {
      expect(isNonPagePath(p)).toBe(false)
    }
  })
})

describe('shouldBootstrap', () => {
  it('acepta una navegación de documento normal', () => {
    expect(shouldBootstrap(navHeaders(), '/')).toBe(true)
  })

  it('rechaza el prefetch de Next (el usuario no abrió nada)', () => {
    expect(shouldBootstrap(navHeaders({ 'next-router-prefetch': '1' }), '/')).toBe(false)
    expect(shouldBootstrap(navHeaders({ purpose: 'prefetch' }), '/')).toBe(false)
    expect(shouldBootstrap(navHeaders({ 'sec-purpose': 'prefetch;prerender' }), '/')).toBe(false)
  })

  it('rechaza los payloads RSC de navegación cliente', () => {
    expect(shouldBootstrap(navHeaders({ rsc: '1' }), '/')).toBe(false)
  })

  it('rechaza subrecursos que no son documentos', () => {
    expect(shouldBootstrap(navHeaders({ 'sec-fetch-dest': 'image' }), '/')).toBe(false)
    expect(shouldBootstrap(navHeaders({ 'sec-fetch-dest': 'script' }), '/')).toBe(false)
    expect(shouldBootstrap(navHeaders({ 'sec-fetch-mode': 'cors' }), '/')).toBe(false)
  })

  it('rechaza bots', () => {
    expect(shouldBootstrap(navHeaders({ 'user-agent': 'Googlebot/2.1' }), '/')).toBe(false)
  })

  it('rechaza rutas internas y el propio panel de admin', () => {
    expect(shouldBootstrap(navHeaders(), '/api/forecast')).toBe(false)
    expect(shouldBootstrap(navHeaders(), '/_next/static/chunk.js')).toBe(false)
    // El admin navegando su panel no es tráfico de producto y contaminaba
    // "Páginas más vistas".
    expect(shouldBootstrap(navHeaders(), '/admin')).toBe(false)
    expect(shouldBootstrap(navHeaders(), '/admin/metrics')).toBe(false)
  })

  it('no bloquea cuando faltan las cabeceras Sec-Fetch (cliente antiguo)', () => {
    const h = new Headers({ 'user-agent': UA_WIN_CHROME })
    expect(shouldBootstrap(h, '/')).toBe(true)
  })
})
