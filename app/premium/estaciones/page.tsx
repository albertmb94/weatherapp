import Link from 'next/link'
import { listPlans, PLAN_FEATURES } from '@/lib/plans'
import { getFeature } from '@/lib/features'
import { listAffiliateProducts } from '@/lib/affiliate'
import CheckoutButton from '@/components/CheckoutButton'

export default async function StationsPage() {
  const flag = await getFeature('feature.stations_checkout')
  const stripe = await getFeature('feature.stripe')
  const checkoutEnabled = flag.enabled && stripe.enabled
  const affiliates = await getFeature('feature.affiliates')
  const plan = (await listPlans(true)).find(p => p.id === 'stations')
  // B-NBT-10: while subscriptions are OFF, recommended-station affiliate
  // products are the live monetization path for this page.
  const products = affiliates.enabled
    ? await listAffiliateProducts({ trigger: 'stations', locale: 'es' })
    : []

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-3xl mx-auto px-4 py-10 space-y-6">
        <Link href="/premium" className="text-xs text-text-tertiary hover:underline">← Premium</Link>
        <header className="space-y-2">
          <h1 className="text-3xl font-semibold">Estaciones</h1>
          <p className="text-sm text-text-tertiary">
            Add-on que cruza el ensemble con observaciones reales de AEMET, Meteocat y Meteoclimatic.
            Compatible con Premium.
          </p>
        </header>

        {!flag.enabled && (
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
            <p className="text-sm">
              <strong>Suscripciones desactivadas.</strong> El checkout de Estaciones aún no está activo.
            </p>
          </div>
        )}

        {products.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Estaciones meteorológicas recomendadas</h2>
            <p className="text-xs text-text-tertiary">
              Enlaces de afiliado: apoyas el proyecto sin pagar más.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {products.map((p) => (
                <a
                  key={p.id}
                  href={`/api/affiliate/redirect?program=amazon&product_id=${encodeURIComponent(p.id)}&trigger=stations&to=${encodeURIComponent(p.affiliateUrl)}`}
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
              <h2 className="text-lg font-semibold">{plan.nameEs}</h2>
              <p className="text-xs text-text-tertiary">{plan.descriptionEs}</p>
            </header>
            <div className="space-y-1">
              {plan.monthlyPriceCents != null && (
                <Price cents={plan.monthlyPriceCents} period="es_mes" />
              )}
              {plan.yearlyPriceCents != null && (
                <Price cents={plan.yearlyPriceCents} period="es_año" highlight />
              )}
            </div>
            <ul className="text-xs space-y-1">
              {plan.features.map((key: string) => {
                const f = PLAN_FEATURES.find(x => x.key === key)
                return f ? (
                  <li key={key} className="flex items-center gap-2">
                    <span className="text-emerald-400">✓</span>
                    <span>{f.labelEs}</span>
                  </li>
                ) : null
              })}
            </ul>
            <CheckoutButton
              kind="stations"
              endpoint="/api/stations/checkout"
              label="Contratar Estaciones (anual)"
              enabled={checkoutEnabled}
              disabledLabel="Próximamente"
            />
          </article>
        )}
      </div>
    </div>
  )
}

function Price({ cents, period, highlight }: { cents: number; period: 'es_mes' | 'es_año'; highlight?: boolean }) {
  const euros = (cents / 100).toFixed(2)
  const label = period === 'es_mes' ? '/ mes' : '/ año'
  return (
    <div className={highlight ? 'font-semibold' : ''}>
      <span className="text-2xl">{euros} €</span>
      <span className="text-xs text-text-tertiary">{label}</span>
    </div>
  )
}
