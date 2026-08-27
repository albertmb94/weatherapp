import type { MetadataRoute } from 'next'
import { appOrigin } from '@/lib/appUrl'
import { LOCALES, DEFAULT_LOCALE, localizedHref } from '@/lib/locale/routing'

/**
 * Sitemap.
 *
 * No existía ninguno. Ahora lista CADA página en los dos idiomas y las
 * enlaza entre sí con `alternates.languages` (hreflang), que es lo que
 * le dice a Google que `/premium` y `/en/premium` son la misma página en
 * distintos idiomas y no contenido duplicado.
 *
 * Quedan fuera el panel de administración, las rutas con token en la URL
 * (/premium/claim, /manage) y los enlaces cortos, que son redirecciones.
 */

interface Entrada {
  path: string
  changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency']
  priority: number
}

const PAGINAS: Entrada[] = [
  { path: '/', changeFrequency: 'hourly', priority: 1 },
  { path: '/premium', changeFrequency: 'monthly', priority: 0.8 },
  { path: '/premium/estaciones', changeFrequency: 'monthly', priority: 0.7 },
  { path: '/support', changeFrequency: 'monthly', priority: 0.4 },
  { path: '/cookies', changeFrequency: 'yearly', priority: 0.2 },
  { path: '/privacy', changeFrequency: 'yearly', priority: 0.2 },
  { path: '/terms', changeFrequency: 'yearly', priority: 0.2 },
  { path: '/affiliate-disclosure', changeFrequency: 'yearly', priority: 0.2 },
]

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = appOrigin()
  // Sin origen canónico configurado, un sitemap con URLs relativas o con
  // el host equivocado es peor que no tenerlo.
  if (!origin) return []
  const lastModified = new Date()

  const entradas: MetadataRoute.Sitemap = []
  for (const p of PAGINAS) {
    const languages: Record<string, string> = {}
    for (const l of LOCALES) languages[l] = `${origin}${localizedHref(p.path, l)}`
    languages['x-default'] = `${origin}${localizedHref(p.path, DEFAULT_LOCALE)}`

    for (const l of LOCALES) {
      entradas.push({
        url: `${origin}${localizedHref(p.path, l)}`,
        lastModified,
        changeFrequency: p.changeFrequency,
        // La versión en el idioma por defecto es la principal; la
        // traducción va ligeramente por debajo.
        priority: l === DEFAULT_LOCALE ? p.priority : Math.max(0.1, p.priority - 0.1),
        alternates: { languages },
      })
    }
  }
  return entradas
}
