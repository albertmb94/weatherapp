import Link from 'next/link'
import { listPlans, PLAN_FEATURES, type Plan } from '@/lib/plans'
import { getFeature } from '@/lib/features'
import CheckoutButton from '@/components/CheckoutButton'

export default async function PremiumPage() {
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
        <Link href="/" className="text-xs text-text-tertiary hover:underline">← Volver</Link>

        <header className="space-y-2">
          <h1 className="text-3xl font-semibold">Hazte Premium</h1>
          <p className="text-sm text-text-tertiary max-w-2xl">
            Desbloquea todos los modelos meteorológicos, 14 días de pronóstico, ciudades ilimitadas y exportación CSV histórica.
          </p>
        </header>

        {!flag.enabled && (
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
            <p className="text-sm">
              <strong>Suscripciones desactivadas.</strong> El checkout de Premium aún no está activo.
              Vuelve cuando el administrador lo habilite.
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {premium && <PlanCard plan={premium} accent="emerald" checkoutEnabled={checkoutEnabled} />}
          {stations && <PlanCard plan={stations} accent="cyan" />}
          {bundle && <PlanCard plan={bundle} accent="violet" />}
        </div>

        <section className="rounded-2xl border border-border bg-surface-raised p-5 space-y-2">
          <h2 className="font-semibold">¿Qué incluye cada feature?</h2>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            {PLAN_FEATURES.map(f => (
              <li key={f.key} className="flex items-center gap-2">
                <span className="text-emerald-400">✓</span>
                <span>{f.labelEs}</span>
              </li>
            ))}
          </ul>
        </section>

        <footer className="text-xs text-text-tertiary space-x-3">
          <Link href="/terms" className="hover:underline">Términos</Link>
          <Link href="/privacy" className="hover:underline">Privacidad</Link>
          <Link href="/cookies" className="hover:underline">Cookies</Link>
          <Link href="/affiliate-disclosure" className="hover:underline">Afiliados</Link>
        </footer>
      </div>
    </div>
  )
}

function PlanCard({ plan, accent, checkoutEnabled = false }: { plan: Plan; accent: 'emerald' | 'cyan' | 'violet'; checkoutEnabled?: boolean }) {
  const accentMap = {
    emerald: 'border-emerald-500/30 bg-emerald-500/5',
    cyan: 'border-cyan-500/30 bg-cyan-500/5',
    violet: 'border-violet-500/30 bg-violet-500/5',
  }
  return (
    <article className={`rounded-2xl border p-5 space-y-3 ${accentMap[accent]}`}>
      {plan.badgeEs && (
        <span className="inline-block px-2 py-0.5 rounded-full bg-accent text-white text-[10px] font-semibold uppercase">
          {plan.badgeEs}
        </span>
      )}
      <header>
        <h3 className="text-lg font-semibold">{plan.nameEs}</h3>
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
        kind="premium"
        endpoint="/api/premium/checkout"
        label="Contratar Premium (anual)"
        enabled={checkoutEnabled}
        disabledLabel="Próximamente"
      />
    </article>
  )
}

function Price({ cents, period, highlight }: { cents: number; period: 'es_mes' | 'es_año'; highlight?: boolean }) {
  const euros = (cents / 100).toFixed(2)
  const label = period === 'es_mes' ? '/ mes' : '/ año'
  return (
    <div className={highlight ? 'font-semibold' : ''}>
      <span className="text-2xl">{euros} €</span>
      <span className="text-xs text-text-tertiary">{label}</span>
      {highlight && period === 'es_año' && (
        <span className="block text-[10px] text-emerald-400">Ahorra vs mensual</span>
      )}
    </div>
  )
}
