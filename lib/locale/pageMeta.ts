import type { Metadata } from 'next'
import type { Locale } from '@/lib/i18n'
import { DEFAULT_LOCALE, isLocale, localeAlternates, localizedHref } from './routing'
import { appOrigin } from '@/lib/appUrl'

/**
 * Metadata de una página pública, en los dos idiomas.
 *
 * Existe para que ninguna página se olvide del canonical ni de los
 * `hreflang`. Ponerlos en el layout del segmento de idioma parecía la
 * solución obvia, pero el canonical de un layout se hereda a todas sus
 * subpáginas: `/cookies` acababa declarando que su versión canónica es
 * `/`, que es como pedirle a Google que la desindexe.
 */

export interface PageCopy {
  title: Record<Locale, string>
  description: Record<Locale, string>
}

export function pageMetadata(path: string, rawLocale: string, copy: PageCopy): Metadata {
  const locale: Locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE
  const origin = appOrigin()
  const title = copy.title[locale]
  const description = copy.description[locale]

  return {
    title,
    description,
    alternates: localeAlternates(path, locale),
    openGraph: {
      type: 'website',
      title,
      description,
      locale: locale === 'es' ? 'es_ES' : 'en_US',
      alternateLocale: locale === 'es' ? ['en_US'] : ['es_ES'],
      ...(origin ? { url: `${origin}${localizedHref(path, locale)}` } : {}),
    },
    twitter: { card: 'summary_large_image', title, description },
  }
}

/** Azúcar para las páginas: `generateMetadata` ya resuelto. */
export function makeGenerateMetadata(path: string, copy: PageCopy) {
  return async function generateMetadata({
    params,
  }: {
    params: Promise<{ locale: string }>
  }): Promise<Metadata> {
    const { locale } = await params
    return pageMetadata(path, locale, copy)
  }
}
