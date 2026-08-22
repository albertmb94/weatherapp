import Link from 'next/link'
import { listPlans, PLAN_FEATURES } from '@/lib/plans'
import { getFeature } from '@/lib/features'

export default async function StationsPage() {
  const flag = await getFeature('feature.stations_checkout')
  const plan = (await listPlans(true)).find(p => p.id === 'stations')

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
            <button disabled className="w-full py-2 rounded-lg bg-accent text-white text-sm font-medium disabled:opacity-50">
              Próximamente
            </button>
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
