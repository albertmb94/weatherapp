import LocaleLink from '@/components/LocaleLink'
import { listPlans } from '@/lib/plans'
import { PERIODO, formatearPrecio, planCopy, planFeatureLabel } from '@/lib/plans.catalog'
import { getFeature } from '@/lib/features'
import { listAffiliateProducts } from '@/lib/affiliate'
import CheckoutButton from '@/components/CheckoutButton'
import type { Metadata } from 'next'
import { makeGenerateMetadata } from '@/lib/locale/pageMeta'
import { DEFAULT_LOCALE, isLocale } from '@/lib/locale/routing'
import type { Locale } from '@/lib/i18n'

const COPY = {
  title: { es: 'Estaciones', en: 'Stations' },
  description: {
    es: 'Observaciones en tiempo real de estaciones meteorológicas cercanas a tu ubicación.',
    en: 'Real-time observations from weather stations near you.',
  },
}

/**
 * Textos de la página.
 *
 * AUDITORÍA: iba entera en español, incluidos el titular y el botón de
 * pago, y además pedía los productos de afiliado con `locale: 'es'` a
 * fuego — de modo que un visitante inglés veía fichas de Amazon España.
 */
const UI: Record<
  Locale,
  {
    volver: string
    h1: string
    intro: string
    desactivadoTitulo: string
    desactivadoCuerpo: string
    recomendadas: string
    avisoAfiliado: string
    contratar: string
    proximamente: string
  }
> = {
  es: {
    volver: '← Premium',
    h1: 'Estaciones',
    intro:
      'Add-on que cruza el ensemble con observaciones reales de AEMET, Meteocat y Meteoclimatic. Compatible con Premium.',
    desactivadoTitulo: 'Suscripciones desactivadas.',
    desactivadoCuerpo: 'El checkout de Estaciones aún no está activo.',
    recomendadas: 'Estaciones meteorológicas recomendadas',
    avisoAfiliado: 'Enlaces de afiliado: apoyas el proyecto sin pagar más.',
    contratar: 'Contratar Estaciones (anual)',
    proximamente: 'Próximamente',
  },
  en: {
    volver: '← Premium',
    h1: 'Stations',
    intro:
      'Add-on that cross-checks the ensemble against real observations from AEMET, Meteocat and Meteoclimatic. Works alongside Premium.',
    desactivadoTitulo: 'Subscriptions are off.',
    desactivadoCuerpo: 'Stations checkout is not live yet.',
    recomendadas: 'Recommended weather stations',
    avisoAfiliado: 'Affiliate links: you support the project at no extra cost.',
    contratar: 'Get Stations (yearly)',
    proximamente: 'Coming soon',
  },
}

export const generateMetadata: (args: {
  params: Promise<{ locale: string }>
}) => Promise<Metadata> = makeGenerateMetadata('/premium/estaciones', COPY)

export default async function StationsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE
  const t = UI[locale]

  const flag = await getFeature('feature.stations_checkout')
  const stripe = await getFeature('feature.stripe')
  const checkoutEnabled = flag.enabled && stripe.enabled
  const affiliates = await getFeature('feature.affiliates')
  const plan = (await listPlans(true)).find(p => p.id === 'stations')
  // B-NBT-10: while subscriptions are OFF, recommended-station affiliate
  // products are the live monetization path for this page.
  //
  // AUDITORIA: el idioma iba a fuego como 'es', asi que un visitante
  // ingles veia fichas del catalogo espanol. `listAffiliateProducts` ya
  // cae a cualquier idioma cuando no hay producto del activo, asi que
  // pasar el real no deja la seccion vacia.
  const products = affiliates.enabled ? await listAffiliateProducts({ trigger: 'stations', locale }) : []

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-3xl mx-auto px-4 py-10 space-y-6">
        <LocaleLink href="/premium" className="text-xs text-text-tertiary hover:underline">
          {t.volver}
        </LocaleLink>
        <header className="space-y-2">
          <h1 className="text-3xl font-semibold">{t.h1}</h1>
          <p className="text-sm text-text-tertiary">{t.intro}</p>
        </header>

        {!flag.enabled && (
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
            <p className="text-sm">
              <strong>{t.desactivadoTitulo}</strong> {t.desactivadoCuerpo}
            </p>
          </div>
        )}

        {products.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">{t.recomendadas}</h2>
            <p className="text-xs text-text-tertiary">{t.avisoAfiliado}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {products.map(p => (
                // AUDITORIA: a estos enlaces les faltaba `rel`. Google EXIGE
                // rel="sponsored" (o nofollow) en enlaces monetizados; sin
                // el, pasan PageRank a Amazon y el sitio se expone a una
                // accion manual. SponsoredSection ya lo hacia bien; esta
                // pagina se habia quedado atras.
                <a
                  key={p.id}
                  href={`/api/affiliate/redirect?program=amazon&product_id=${encodeURIComponent(p.id)}&trigger=stations&to=${encodeURIComponent(p.affiliateUrl)}`}
                  rel="sponsored nofollow noopener"
                  target="_blank"
                  className="rounded-2xl border border-border bg-surface-raised p-4 hover:border-accent/60 transition-colors"
                >
                  <div className="text-sm font-medium">{p.title}</div>
                  {p.priceLabel ? (
                    <div className="text-xs text-text-tertiary mt-0.5">{p.priceLabel}</div>
                  ) : null}
                </a>
              ))}
            </div>
          </section>
        )}

        {plan && (
          <article className="rounded-2xl border border-cyan-500/30 bg-cyan-500/5 p-5 space-y-3">
            <header>
              <h2 className="text-lg font-semibold">{planCopy(plan, locale).name}</h2>
              <p className="text-xs text-text-tertiary">{planCopy(plan, locale).description}</p>
            </header>
            <div className="space-y-1">
              {plan.monthlyPriceCents != null && (
                <Price cents={plan.monthlyPriceCents} period="mes" locale={locale} />
              )}
              {plan.yearlyPriceCents != null && (
                <Price cents={plan.yearlyPriceCents} period="ano" locale={locale} highlight />
              )}
            </div>
            <ul className="text-xs space-y-1">
              {plan.features.map((key: string) => {
                const label = planFeatureLabel(key, locale)
                return label ? (
                  <li key={key} className="flex items-center gap-2">
                    <span className="text-emerald-400">✓</span>
                    <span>{label}</span>
                  </li>
                ) : null
              })}
            </ul>
            <CheckoutButton
              kind="stations"
              endpoint="/api/stations/checkout"
              label={t.contratar}
              enabled={checkoutEnabled}
              disabledLabel={t.proximamente}
            />
          </article>
        )}
      </div>
    </div>
  )
}

function Price({
  cents,
  period,
  locale,
  highlight,
}: {
  cents: number
  period: 'mes' | 'ano'
  locale: Locale
  highlight?: boolean
}) {
  return (
    <div className={highlight ? 'font-semibold' : ''}>
      <span className="text-2xl">{formatearPrecio(cents, locale)}</span>
      <span className="text-xs text-text-tertiary">{PERIODO[locale][period]}</span>
    </div>
  )
}
