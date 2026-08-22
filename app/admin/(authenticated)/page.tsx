import Link from 'next/link'

export default function AdminPage() {
  return (
    <div className="p-6 space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Panel de administración</h1>
        <p className="text-sm text-text-tertiary">
          Activa y configura las funcionalidades de monetización. Todas las features están en OFF por defecto.
        </p>
      </header>

      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        <QuickAction href="/admin/features" title="Feature flags" description="Activa/desactiva cada funcionalidad de monetización." />
        <QuickAction href="/admin/plans" title="Planes" description="Edita precios, descripciones y Stripe Price IDs de Premium, Estaciones y Bundle." />
        <QuickAction href="/admin/users" title="Usuarios" description="Busca suscriptores y concede grants manuales." />
        <QuickAction href="/admin/emails" title="Emails" description="Edita templates transaccionales y envía campañas manuales." />
        <QuickAction href="/admin/affiliates" title="Afiliados" description="Catálogo de productos Amazon y secciones patrocinadas." />
        <QuickAction href="/admin/ads" title="Ads" description="Configura AdSense y EthicalAds." />
        <QuickAction href="/admin/newsletter" title="Newsletter" description="Suscriptores y campañas semanales." />
        <QuickAction href="/admin/push" title="Push" description="Configura VAPID y tipos de alerta." />
        <QuickAction href="/admin/donations" title="Donaciones" description="Ko-fi y GitHub Sponsors." />
        <QuickAction href="/admin/metrics" title="Métricas" description="Tráfico, retención, funnels, cohortes." />
        <QuickAction href="/admin/health" title="Health" description="Estado de DB, Stripe, Resend, Open-Meteo." />
        <QuickAction href="/admin/settings" title="Settings" description="Variables de entorno y configuración global." />
      </section>
    </div>
  )
}

function QuickAction({ href, title, description }: { href: string; title: string; description: string }) {
  return (
    <Link
      href={href}
      className="rounded-2xl border border-border bg-surface-raised p-4 hover:bg-surface transition-colors"
    >
      <div className="font-medium">{title}</div>
      <div className="text-xs text-text-tertiary mt-1">{description}</div>
    </Link>
  )
}
