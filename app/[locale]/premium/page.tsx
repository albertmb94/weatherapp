import LocaleLink from '@/components/LocaleLink'
import { listPlans } from '@/lib/plans'
import { PLAN_FEATURES, planCopy, planFeatureLabel, type Plan } from '@/lib/plans.catalog'
import { getFeature } from '@/lib/features'
import CheckoutButton from '@/components/CheckoutButton'
// AUDITORIA: esta pagina no exportaba metadata, asi que heredaba el
// titulo y la descripcion genericos del layout. Ahora los declara en los
// dos idiomas, con su canonical y sus hreflang propios.
import type { Metadata } from 'next'
import { makeGenerateMetadata } from '@/lib/locale/pageMeta'
import { DEFAULT_LOCALE, isLocale } from '@/lib/locale/routing'
import type { Locale } from '@/lib/i18n'

const COPY = {
  title: { es: 'Premium', en: 'Premium' },
  description: {
    es: 'Todos los modelos meteorológicos, 14 días de predicción, ciudades ilimitadas y exportación de datos.',
    en: 'Every weather model, 14-day forecasts, unlimited cities and data export.',
  },
}

/**
 * Textos de la página.
 *
 * AUDITORÍA: estaban escritos en español dentro del JSX, y las filas de
 * planes se leían siempre por `nameEs` / `labelEs` **aunque la
 * traducción ya existiera** en la base de datos y en el catálogo. Esta
 * es una de las cuatro rutas de conversión y está en el sitemap: Google
 * indexaba /en/premium con el título en inglés y el cuerpo en español,
 * y quien llegaba en inglés se encontraba la página de pago sin poder
 * leerla.
 */
const UI: Record<
  Locale,
  {
    volver: string
    h1: string
    intro: string
    desactivadoTitulo: string
    desactivadoCuerpo: string
    queIncluye: string
    contratar: string
    proximamente: string
    porMes: string
    porAno: string
    ahorro: string
    terminos: string
    privacidad: string
    cookies: string
    afiliados: string
  }
> = {
  es: {
    volver: '← Volver',
    h1: 'Hazte Premium',
    intro:
      'Desbloquea todos los modelos meteorológicos, 14 días de pronóstico, ciudades ilimitadas y exportación CSV histórica.',
    desactivadoTitulo: 'Suscripciones desactivadas.',
    desactivadoCuerpo:
      'El checkout de Premium aún no está activo. Vuelve cuando el administrador lo habilite.',
    queIncluye: '¿Qué incluye cada plan?',
    contratar: 'Contratar Premium (anual)',
    proximamente: 'Próximamente',
    porMes: '/ mes',
    porAno: '/ año',
    ahorro: 'Ahorra frente al mensual',
    terminos: 'Términos',
    privacidad: 'Privacidad',
    cookies: 'Cookies',
    afiliados: 'Afiliados',
  },
  en: {
    volver: '← Back',
    h1: 'Go Premium',
    intro:
      'Unlock every weather model, 14-day forecasts, unlimited cities and historical CSV export.',
    desactivadoTitulo: 'Subscriptions are off.',
    desactivadoCuerpo:
      'Premium checkout is not live yet. Check back once the administrator enables it.',
    queIncluye: 'What does each plan include?',
    contratar: 'Get Premium (yearly)',
    proximamente: 'Coming soon',
    porMes: '/ mo',
    porAno: '/ yr',
    ahorro: 'Cheaper than monthly',
    terminos: 'Terms',
    privacidad: 'Privacy',
    cookies: 'Cookies',
    afiliados: 'Affiliates',
  },
}

export const generateMetadata: (args: {
  params: Promise<{ locale: string }>
}) => Promise<Metadata> = makeGenerateMetadata('/premium', COPY)

export default async function PremiumPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE
  const t = UI[locale]

  const flag = await getFeature('feature.premium_checkout')
  const stripe = await getFeature('feature.stripe')
  const checkoutEnabled = flag.enabled && stripe.enabled
  const plans = await listPlans(true)
  const premium = plans.find(p => p.id === 'premium')
  const stations = plans.find(p => p.id === 'stations')
  const bundle = plans.find(p => p.id === 'bundle')

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-5xl mx-auto px-4 py-10 space-y-8">
        <LocaleLink href="/" className="text-xs text-text-tertiary hover:underline">
          {t.volver}
        </LocaleLink>

        <header className="space-y-2">
          <h1 className="text-3xl font-semibold">{t.h1}</h1>
          <p className="text-sm text-text-tertiary max-w-2xl">{t.intro}</p>
        </header>

        {!flag.enabled && (
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
            <p className="text-sm">
              <strong>{t.desactivadoTitulo}</strong> {t.desactivadoCuerpo}
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {premium && (
            <PlanCard plan={premium} accent="emerald" locale={locale} checkoutEnabled={checkoutEnabled} />
          )}
          {stations && <PlanCard plan={stations} accent="cyan" locale={locale} />}
          {bundle && <PlanCard plan={bundle} accent="violet" locale={locale} />}
        </div>

        <section className="rounded-2xl border border-border bg-surface-raised p-5 space-y-2">
          <h2 className="font-semibold">{t.queIncluye}</h2>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            {PLAN_FEATURES.map(f => (
              <li key={f.key} className="flex items-center gap-2">
                <span className="text-emerald-400">✓</span>
                <span>{locale === 'es' ? f.labelEs : f.labelEn}</span>
              </li>
            ))}
          </ul>
        </section>

        <footer className="text-xs text-text-tertiary space-x-3">
          <LocaleLink href="/terms" className="hover:underline">
            {t.terminos}
          </LocaleLink>
          <LocaleLink href="/privacy" className="hover:underline">
            {t.privacidad}
          </LocaleLink>
          <LocaleLink href="/cookies" className="hover:underline">
            {t.cookies}
          </LocaleLink>
          <LocaleLink href="/affiliate-disclosure" className="hover:underline">
            {t.afiliados}
          </LocaleLink>
        </footer>
      </div>
    </div>
  )
}

function PlanCard({
  plan,
  accent,
  locale,
  checkoutEnabled = false,
}: {
  plan: Plan
  accent: 'emerald' | 'cyan' | 'violet'
  locale: Locale
  checkoutEnabled?: boolean
}) {
  const accentMap = {
    emerald: 'border-emerald-500/30 bg-emerald-500/5',
    cyan: 'border-cyan-500/30 bg-cyan-500/5',
    violet: 'border-violet-500/30 bg-violet-500/5',
  }
  const t = UI[locale]
  const copy = planCopy(plan, locale)
  return (
    <article className={`rounded-2xl border p-5 space-y-3 ${accentMap[accent]}`}>
      {copy.badge && (
        <span className="inline-block px-2 py-0.5 rounded-full bg-accent text-white text-[10px] font-semibold uppercase">
          {copy.badge}
        </span>
      )}
      <header>
        <h3 className="text-lg font-semibold">{copy.name}</h3>
        <p className="text-xs text-text-tertiary">{copy.description}</p>
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
        kind="premium"
        endpoint="/api/premium/checkout"
        label={t.contratar}
        enabled={checkoutEnabled}
        disabledLabel={t.proximamente}
      />
    </article>
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
  const t = UI[locale]
  // Los precios se guardan en céntimos de euro. Se formatean con la
  // convención de cada idioma (1.234,56 € frente a €1,234.56); la
  // moneda no cambia, sólo cómo se escribe.
  const importe = new Intl.NumberFormat(locale === 'es' ? 'es-ES' : 'en-IE', {
    style: 'currency',
    currency: 'EUR',
  }).format(cents / 100)
  return (
    <div className={highlight ? 'font-semibold' : ''}>
      <span className="text-2xl">{importe}</span>
      <span className="text-xs text-text-tertiary">{period === 'mes' ? t.porMes : t.porAno}</span>
      {highlight && period === 'ano' && (
        <span className="block text-[10px] text-emerald-400">{t.ahorro}</span>
      )}
    </div>
  )
}
