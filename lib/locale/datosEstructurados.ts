import type { Locale } from '@/lib/i18n'
import { localizedHref } from './routing'

/**
 * JSON-LD para buscadores.
 *
 * POR QUÉ. La app no emitía ni un `ld+json`. Los datos estructurados
 * no mejoran el posicionamiento por sí solos, pero son lo que permite
 * a Google entender qué ES esto (una aplicación web gratuita de
 * meteorología, no un blog) y mostrar el resultado con más superficie:
 * nombre, icono y enlaces del sitio. Es de lo más barato que mueve el
 * porcentaje de clics desde el buscador.
 *
 * Se emite en los dos idiomas: `inLanguage` y las descripciones
 * cambian, y las URLs usan `localizedHref` para no declarar como
 * canónica una que redirige.
 */

const NOMBRE = 'Weather Model Comparison'

const DESCRIPCION: Record<Locale, string> = {
  es: 'Compara varios modelos meteorológicos a la vez y mira cuál acierta más en tu ciudad.',
  en: 'Compare several weather models side by side and see which one gets your city right.',
}

/**
 * Grafo del sitio: quién publica esto y qué sitio es.
 *
 * Va en el layout de idioma, así que aparece en TODAS las páginas
 * públicas. Es lo correcto para `Organization` y `WebSite`: describen
 * el sitio, no la página.
 */
export function grafoSitio(origin: string, locale: Locale): object {
  const inicio = `${origin}${localizedHref('/', locale)}`
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': `${origin}#organization`,
        name: NOMBRE,
        url: origin,
        logo: {
          '@type': 'ImageObject',
          url: `${origin}/icon-512.svg`,
          width: 512,
          height: 512,
        },
      },
      {
        '@type': 'WebSite',
        '@id': `${origin}#website`,
        name: NOMBRE,
        url: inicio,
        description: DESCRIPCION[locale],
        inLanguage: locale === 'es' ? 'es-ES' : 'en-US',
        publisher: { '@id': `${origin}#organization` },
      },
    ],
  }
}

/**
 * La portada, además, ES una aplicación.
 *
 * `WebApplication` con `offers` a precio 0 es lo que distingue "una
 * herramienta que puedo usar ya" de "una página que habla del tiempo".
 * Sólo se emite en la portada: declararlo en el layout haría que
 * /cookies y /terms dijeran ser la aplicación.
 */
export function grafoPortada(origin: string, locale: Locale): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    '@id': `${origin}#webapp`,
    name: NOMBRE,
    url: `${origin}${localizedHref('/', locale)}`,
    description: DESCRIPCION[locale],
    inLanguage: locale === 'es' ? 'es-ES' : 'en-US',
    applicationCategory: 'WeatherApplication',
    operatingSystem: 'Any',
    browserRequirements: 'Requires JavaScript',
    isAccessibleForFree: true,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' },
    publisher: { '@id': `${origin}#organization` },
  }
}

/**
 * Serializa para incrustar en un `<script>`.
 *
 * El escape de `<` es obligatorio: sin él, una cadena que contuviera
 * `</script>` cerraría la etiqueta antes de tiempo. Hoy ninguna lo
 * hace, pero el copy lo edita gente y esto no puede depender de eso.
 */
export function serializarJsonLd(datos: object): string {
  return JSON.stringify(datos).replace(/</g, '\\u003c')
}
