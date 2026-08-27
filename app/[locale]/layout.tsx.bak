import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import type { Locale } from '@/lib/i18n'
import { LOCALES, DEFAULT_LOCALE, isLocale, localizedHref } from '@/lib/locale/routing'
import { appOrigin } from '@/lib/appUrl'
import { LocaleProvider } from '@/lib/LocaleContext'

/**
 * Layout del segmento de idioma.
 *
 * Todo lo público cuelga de aquí. El panel de administración y las rutas
 * de API quedan fuera a propósito (ver lib/locale/routing.ts).
 *
 * Este layout NO renderiza <html>: el layout raíz sigue siendo
 * app/layout.tsx, que fija `lang` a partir de la cabecera que escribe el
 * proxy. Tener dos layouts raíz (uno para el sitio y otro para el
 * admin) habría obligado a recargar la página entera al cruzar de uno a
 * otro y a duplicar todo el árbol de proveedores, a cambio de nada.
 */

export const dynamic = 'force-dynamic'

/** Las dos variantes se conocen de antemano. */
export function generateStaticParams() {
  return LOCALES.map(locale => ({ locale }))
}

const COPY: Record<Locale, { title: string; description: string }> = {
  es: {
    title: 'Weather Model Comparison',
    description:
      'Compara varios modelos meteorológicos a la vez y mira cuál acierta más en tu ciudad.',
  },
  en: {
    title: 'Weather Model Comparison',
    description:
      'Compare several weather models side by side and see which one gets your city right.',
  },
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale: raw } = await params
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE
  const copy = COPY[locale]
  const origin = appOrigin()

  // OJO: aquí NO va `alternates`. El canonical y los hreflang de un
  // layout se heredan a TODAS sus subpáginas, así que ponerlos aquí hacía
  // que /cookies declarase que su versión canónica es / — es decir, le
  // decía a Google que la página de cookies "es" la portada, lo que la
  // saca del índice. Cada página aporta los suyos con
  // `localeAlternates(ruta, idioma)`.
  return {
    title: { default: copy.title, template: `%s · ${copy.title}` },
    description: copy.description,
    openGraph: {
      type: 'website',
      siteName: copy.title,
      title: copy.title,
      description: copy.description,
      locale: locale === 'es' ? 'es_ES' : 'en_US',
      alternateLocale: locale === 'es' ? ['en_US'] : ['es_ES'],
      ...(origin ? { url: `${origin}${localizedHref('/', locale)}` } : {}),
    },
    twitter: {
      card: 'summary_large_image',
      title: copy.title,
      description: copy.description,
    },
  }
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  // Un segmento que no sea un idioma conocido es un 404 de verdad, no un
  // "renderiza en español lo que sea": sin esto, /fr/premium respondería
  // 200 y Google indexaría infinitas URLs equivalentes.
  if (!isLocale(locale)) notFound()

  // El idioma se ENTREGA al proveedor desde el servidor. Es el único
  // sitio del árbol que lo conoce sin deducirlo, y montarlo aquí evita
  // el hook de ruta en el layout raíz que rompía la hidratación (ver
  // lib/LocaleContext.tsx).
  return <LocaleProvider locale={locale}>{children}</LocaleProvider>
}
