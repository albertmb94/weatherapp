import { Suspense } from 'react'
import HomeContent from '@/app/home-content'
import { getFeature } from '@/lib/features'

import type { Metadata } from 'next'
import { makeGenerateMetadata } from '@/lib/locale/pageMeta'
import { DEFAULT_LOCALE, isLocale } from '@/lib/locale/routing'
import { grafoPortada, serializarJsonLd } from '@/lib/locale/datosEstructurados'
import { appOrigin } from '@/lib/appUrl'
import type { Locale } from '@/lib/i18n'

const COPY = {
  title: { es: 'Weather Model Comparison', en: 'Weather Model Comparison' },
  description: {
    es: 'Compara varios modelos meteorológicos a la vez y mira cuál acierta más en tu ciudad.',
    en: 'Compare several weather models side by side and see which one gets your city right.',
  },
}

export const generateMetadata: (args: {
  params: Promise<{ locale: string }>
}) => Promise<Metadata> = makeGenerateMetadata('/', COPY)

export const DEFAULT_KOFI_URL = 'https://ko-fi.com/F8C225NYMV'

export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: rawLocale } = await params
  const locale: Locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE
  const origin = appOrigin()

  // Ko-fi URL single source of truth: feature.kofi.url (admin-editable),
  // con fallback al perfil por defecto. Se pasa como prop para que el
  // header móvil y el overlay de escritorio usen la misma fuente.
  const kofi = await getFeature('feature.kofi')
  const kofiUrl =
    typeof kofi.config.url === 'string' && kofi.config.url.trim()
      ? kofi.config.url.trim()
      : DEFAULT_KOFI_URL

  return (
    <>
      {/* Sólo la portada declara ser la aplicación. Ponerlo en el
          layout haría que /cookies y /terms dijeran serlo también. */}
      {origin ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializarJsonLd(grafoPortada(origin, locale)) }}
        />
      ) : null}
      <Suspense fallback={<LoadingShell />}>
        <HomeContent kofiUrl={kofiUrl} />
      </Suspense>
    </>
  )
}

function LoadingShell() {
  return (
    <div className="h-screen flex flex-col bg-gray-950 text-white">
      <header className="px-3 py-2 bg-gray-900 border-b border-gray-800">
        <div className="flex items-center gap-2">
          <div className="h-5 w-24 bg-gray-800 rounded animate-pulse" />
          <div className="h-8 w-44 bg-gray-800 rounded animate-pulse" />
          <div className="h-8 w-40 bg-gray-800 rounded animate-pulse" />
        </div>
      </header>
      <div className="flex-1 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-gray-600 border-t-blue-500 rounded-full animate-spin" />
      </div>
    </div>
  )
}
