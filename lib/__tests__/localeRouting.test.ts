import { describe, it, expect } from 'vitest'
import {
  isLocale,
  isLocaleExemptPath,
  splitLocale,
  localizedHref,
  switchLocaleUrl,
  negotiateLocale,
  DEFAULT_LOCALE,
} from '@/lib/locale/routing'

describe('isLocale', () => {
  it('acepta sólo los idiomas soportados', () => {
    expect(isLocale('es')).toBe(true)
    expect(isLocale('en')).toBe(true)
    expect(isLocale('fr')).toBe(false)
    expect(isLocale('')).toBe(false)
    expect(isLocale(null)).toBe(false)
    expect(isLocale(undefined)).toBe(false)
  })

  it('no confunde una ruta que EMPIEZA por esas letras', () => {
    // '/estaciones' empieza por 'es': si el split fuera por prefijo de
    // cadena en vez de por segmento, se comería la ruta.
    expect(isLocale('estaciones')).toBe(false)
    expect(isLocale('english')).toBe(false)
  })
})

describe('isLocaleExemptPath', () => {
  it('exime al panel de administración, la API y los enlaces cortos', () => {
    for (const p of ['/admin', '/admin/metrics', '/api/forecast', '/s/abc123']) {
      expect(isLocaleExemptPath(p), p).toBe(true)
    }
  })

  it('exime a los ficheros que no son páginas', () => {
    for (const p of ['/manifest.json', '/sw.js', '/robots.txt', '/sitemap.xml', '/favicon.ico', '/icon-192.svg', '/_next/static/x.js']) {
      expect(isLocaleExemptPath(p), p).toBe(true)
    }
  })

  it('NO exime a las páginas públicas', () => {
    for (const p of ['/', '/premium', '/premium/estaciones', '/cookies', '/manage']) {
      expect(isLocaleExemptPath(p), p).toBe(false)
    }
  })

  it('no confunde /administracion con /admin', () => {
    expect(isLocaleExemptPath('/administracion')).toBe(false)
  })
})

describe('splitLocale', () => {
  it('separa el prefijo cuando existe', () => {
    expect(splitLocale('/en')).toEqual({ locale: 'en', rest: '/' })
    expect(splitLocale('/en/premium')).toEqual({ locale: 'en', rest: '/premium' })
    expect(splitLocale('/es/cookies')).toEqual({ locale: 'es', rest: '/cookies' })
    expect(splitLocale('/en/premium/estaciones')).toEqual({ locale: 'en', rest: '/premium/estaciones' })
  })

  it('devuelve locale null cuando no lo lleva', () => {
    expect(splitLocale('/')).toEqual({ locale: null, rest: '/' })
    expect(splitLocale('/premium')).toEqual({ locale: null, rest: '/premium' })
  })

  it('NO se come rutas que empiezan por las letras del idioma', () => {
    // El caso peligroso de verdad: esta app tiene /premium/estaciones.
    expect(splitLocale('/estaciones')).toEqual({ locale: null, rest: '/estaciones' })
    expect(splitLocale('/entrada')).toEqual({ locale: null, rest: '/entrada' })
  })

  it('tolera barras finales', () => {
    expect(splitLocale('/en/')).toEqual({ locale: 'en', rest: '/' })
  })
})

describe('localizedHref', () => {
  it('el español NO lleva prefijo: las URLs existentes no cambian', () => {
    // Es la razón de ser del esquema: hay enlaces compartidos, enlaces
    // cortos, URLs de retorno de Stripe y un histórico de page_views
    // con estas rutas.
    expect(localizedHref('/', 'es')).toBe('/')
    expect(localizedHref('/premium', 'es')).toBe('/premium')
    expect(localizedHref('/premium/estaciones', 'es')).toBe('/premium/estaciones')
  })

  it('el inglés lleva prefijo', () => {
    expect(localizedHref('/', 'en')).toBe('/en')
    expect(localizedHref('/premium', 'en')).toBe('/en/premium')
    expect(localizedHref('/cookies', 'en')).toBe('/en/cookies')
  })

  it('las rutas exentas nunca se prefijan, ni siquiera en inglés', () => {
    // Prefijar /api/... o /admin las romperia por completo.
    expect(localizedHref('/api/forecast', 'en')).toBe('/api/forecast')
    expect(localizedHref('/admin/metrics', 'en')).toBe('/admin/metrics')
    expect(localizedHref('/s/abc', 'en')).toBe('/s/abc')
  })

  it('normaliza rutas sin barra inicial', () => {
    expect(localizedHref('premium', 'en')).toBe('/en/premium')
  })
})

describe('switchLocaleUrl', () => {
  it('cambia de español a inglés conservando la ruta', () => {
    expect(switchLocaleUrl('/premium', '', 'en')).toBe('/en/premium')
    expect(switchLocaleUrl('/', '', 'en')).toBe('/en')
  })

  it('cambia de inglés a español quitando el prefijo', () => {
    expect(switchLocaleUrl('/en/premium', '', 'es')).toBe('/premium')
    expect(switchLocaleUrl('/en', '', 'es')).toBe('/')
  })

  it('CONSERVA el query string: el estado de la app vive ahí', () => {
    // Cambiar de idioma no debe perder la ciudad, los modelos ni el rango.
    const qs = '?lat=41.4501&lon=2.2478&models=icon,gfs&range=7'
    expect(switchLocaleUrl('/', qs, 'en')).toBe(`/en${qs}`)
    expect(switchLocaleUrl('/en', qs, 'es')).toBe(`/${qs}`)
  })

  it('acepta el query sin la interrogación inicial', () => {
    expect(switchLocaleUrl('/', 'lat=41', 'en')).toBe('/en?lat=41')
  })

  it('ignora un query vacío', () => {
    expect(switchLocaleUrl('/premium', '?', 'en')).toBe('/en/premium')
  })
})

describe('negotiateLocale', () => {
  it('detecta español e inglés', () => {
    expect(negotiateLocale('es-ES,es;q=0.9')).toBe('es')
    expect(negotiateLocale('en-US,en;q=0.9')).toBe('en')
  })

  it('respeta el factor q y no el orden', () => {
    expect(negotiateLocale('en;q=0.3,es;q=0.9')).toBe('es')
    expect(negotiateLocale('es;q=0.2,en-GB;q=0.8')).toBe('en')
  })

  it('cae al idioma por defecto con idiomas no soportados', () => {
    expect(negotiateLocale('fr-FR,de;q=0.8')).toBe(DEFAULT_LOCALE)
    expect(negotiateLocale(null)).toBe(DEFAULT_LOCALE)
    expect(negotiateLocale('')).toBe(DEFAULT_LOCALE)
  })

  it('el catalán no es inglés: cae al defecto (español)', () => {
    expect(negotiateLocale('ca-ES,ca;q=0.9')).toBe('es')
  })
})
