/**
 * Locale como segmento de ruta.
 *
 * EL PROBLEMA QUE RESUELVE: el idioma vivía SÓLO en localStorage
 * (lib/LocaleContext.tsx) y `app/layout.tsx` emitía `lang="es"` a fuego,
 * corregido después por un efecto de cliente. Consecuencias:
 *
 *   - Todo rastreador y todo lector de pantalla veía español, también
 *     para quien navegaba en inglés.
 *   - No existía ninguna URL en inglés: compartir un enlace perdía el
 *     idioma, y Google no tenía nada que indexar en inglés.
 *   - El idioma no se podía enlazar, ni forzar, ni cachear por separado.
 *
 * ESQUEMA DE URLS — prefijo "sólo cuando hace falta":
 *
 *     español (por defecto)   /            /premium      /cookies
 *     inglés                  /en          /en/premium   /en/cookies
 *
 * El español NO lleva prefijo a propósito. Este sitio ya está en
 * producción: hay enlaces compartidos, enlaces cortos, URLs de retorno
 * de Stripe, enlaces en correos y un histórico de `page_views` con esas
 * rutas. Prefijar el idioma mayoritario habría roto o redirigido todo
 * eso, y habría partido en dos las métricas de la página principal a
 * cambio de nada.
 *
 * `/es/...` se acepta pero se redirige a la forma sin prefijo, para que
 * cada página tenga UNA sola URL canónica por idioma.
 */

import type { Locale } from '@/lib/i18n'

export const LOCALES = ['es', 'en'] as const
export const DEFAULT_LOCALE: Locale = 'es'

export function isLocale(value: string | null | undefined): value is Locale {
  return value === 'es' || value === 'en'
}

/**
 * Rutas que NUNCA llevan idioma en la URL.
 *
 * El panel de administración es de uso interno y está sólo en español;
 * las rutas de API, los enlaces cortos y los ficheros estáticos no son
 * páginas.
 */
export function isLocaleExemptPath(pathname: string): boolean {
  return (
    pathname === '/admin' ||
    pathname.startsWith('/admin/') ||
    pathname.startsWith('/api/') ||
    pathname.startsWith('/s/') ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/icon-') ||
    pathname === '/manifest.json' ||
    pathname === '/sw.js' ||
    pathname === '/favicon.ico' ||
    pathname === '/robots.txt' ||
    pathname === '/sitemap.xml'
  )
}

export interface SplitPath {
  /** Idioma explícito en la URL, o null si no lo llevaba. */
  locale: Locale | null
  /** Ruta sin el prefijo de idioma, siempre empezando por '/'. */
  rest: string
}

/** Separa el prefijo de idioma de una ruta. */
export function splitLocale(pathname: string): SplitPath {
  const segments = pathname.split('/').filter(Boolean)
  const first = segments[0]
  if (isLocale(first)) {
    const rest = `/${segments.slice(1).join('/')}`
    return { locale: first, rest: rest === '/' ? '/' : rest.replace(/\/$/, '') }
  }
  return { locale: null, rest: pathname === '' ? '/' : pathname }
}

/**
 * Construye el href de una ruta interna en un idioma concreto.
 *
 * @param path   Ruta SIN prefijo de idioma ('/', '/premium', '/cookies').
 * @param locale Idioma destino.
 */
export function localizedHref(path: string, locale: Locale): string {
  const clean = path.startsWith('/') ? path : `/${path}`
  // Las rutas exentas se devuelven tal cual: prefijarlas las rompería.
  if (isLocaleExemptPath(clean)) return clean
  if (locale === DEFAULT_LOCALE) return clean
  return clean === '/' ? `/${locale}` : `/${locale}${clean}`
}

/**
 * URL absoluta de la tarjeta social del idioma dado.
 *
 * POR QUÉ NO SE DEJA QUE NEXT LA DEDUZCA. La convención de fichero
 * genera la URL desde el segmento de ruta, así que en español emitía
 * `/es/opengraph-image` — y el proxy responde a `/es/...` con un 308
 * hacia la versión sin prefijo, porque el español es el idioma por
 * defecto y su URL canónica no lleva prefijo. La tarjeta acababa
 * detrás de un salto que algunos rastreadores no siguen para
 * imágenes. Apuntando a la URL canónica desde el principio, no hay
 * salto que seguir.
 */
export function socialCardUrl(origin: string, locale: Locale): string {
  return `${origin}${localizedHref('/opengraph-image', locale)}`
}

/**
 * Cambia el idioma de una URL COMPLETA conservando ruta y query.
 * Es lo que usa el selector de idioma.
 */
export function switchLocaleUrl(pathname: string, search: string, next: Locale): string {
  const { rest } = splitLocale(pathname)
  const base = localizedHref(rest, next)
  return search && search !== '?' ? `${base}${search.startsWith('?') ? search : `?${search}`}` : base
}

/**
 * Idioma preferido según la cabecera Accept-Language.
 *
 * Sólo se usa para decidir a dónde mandar a un visitante NUEVO que entra
 * sin prefijo; una vez elige, manda la URL.
 */
export function negotiateLocale(acceptLanguage: string | null): Locale {
  if (!acceptLanguage) return DEFAULT_LOCALE
  const entries = acceptLanguage
    .split(',')
    .map(part => {
      const [tag, q] = part.trim().split(';q=')
      return { tag: (tag ?? '').trim().toLowerCase(), q: q ? Number(q) : 1 }
    })
    .filter(e => e.tag && Number.isFinite(e.q))
    .sort((a, b) => b.q - a.q)

  for (const { tag } of entries) {
    const base = tag.split('-')[0]
    if (base === 'es') return 'es'
    if (base === 'en') return 'en'
  }
  return DEFAULT_LOCALE
}

/**
 * Ruta INTERNA que Next debe resolver para una URL publica.
 *
 * Todas las paginas viven bajo `app/[locale]/`, asi que una peticion a
 * `/premium` no casa con ninguna ruta por si sola: el proxy la reescribe
 * a `/es/premium`. Es la contrapartida de `localizedHref`, que hace el
 * camino inverso (de ruta interna a URL publica).
 */
export function internalLocalePath(pathname: string, locale: Locale): string {
  const clean = pathname === '' ? '/' : pathname
  if (isLocaleExemptPath(clean)) return clean
  const { rest } = splitLocale(clean)
  return rest === '/' ? `/${locale}` : `/${locale}${rest}`
}

/**
 * Bloque `alternates` de una pagina concreta: su canonical y los
 * hreflang de todos los idiomas.
 *
 * TIENE QUE SER POR PAGINA. Ponerlo en el layout del segmento de idioma
 * parece comodo pero es un error grave: el canonical del layout se
 * hereda a TODAS las subpaginas, asi que /cookies acababa declarando que
 * su version canonica es /. Eso le dice a Google que la pagina de
 * cookies es la portada, y la saca del indice.
 */
export function localeAlternates(path: string, locale: Locale): {
  canonical: string
  languages: Record<string, string>
} {
  const languages: Record<string, string> = {}
  for (const l of LOCALES) languages[l] = localizedHref(path, l)
  languages['x-default'] = localizedHref(path, DEFAULT_LOCALE)
  return { canonical: localizedHref(path, locale), languages }
}

/** Cookie con la eleccion EXPLICITA de idioma. El proxy la respeta al
 *  entrar por una URL sin prefijo; nunca se deduce de Accept-Language
 *  para un rastreador. */
export const LOCALE_COOKIE = 'wthr_locale'

/** Cabecera con la que el proxy comunica el idioma al layout raíz, que
 *  está por encima del segmento `[locale]` y no recibe params. */
export const LOCALE_HEADER = 'x-wthr-locale'
