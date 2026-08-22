import { getAdminMetrics } from '@/lib/analytics'

export const dynamic = 'force-dynamic'

/** B-NBT-10: full visitor dashboard — DAU series, new vs returning,
 *  devices/browsers/countries, top paths, referrers and UTM sources.
 *  Server component reading lib/analytics directly (auth is enforced
 *  by the (authenticated) layout). */

function Kpi({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface-raised p-4">
      <div className="text-xs text-text-tertiary">{label}</div>
      <div className="text-2xl font-semibold mt-1 tabular-nums">{typeof value === 'number' ? value.toLocaleString('es-ES') : value}</div>
      {sub ? <div className="text-[11px] text-text-muted mt-0.5">{sub}</div> : null}
    </div>
  )
}

function Bars({ series }: { series: { date: string; devices: number; views: number }[] }) {
  const max = Math.max(1, ...series.map(s => s.views))
  return (
    <div className="flex items-end gap-[3px] h-40 mt-2" role="img" aria-label="Dispositivos únicos por día (30 días)">
      {series.map((s) => {
        const vh = Math.round((s.views / max) * 100)
        const dh = Math.max(4, Math.round((s.devices / Math.max(1, s.views)) * vh))
        return (
          <div key={s.date} className="flex-1 flex flex-col justify-end items-stretch group relative" title={`${s.date}: ${s.devices} dispositivos / ${s.views} vistas`}>
            <div className="rounded-t bg-accent/25" style={{ height: `${Math.max(vh - dh, 0)}%` }} />
            <div className="bg-accent" style={{ height: `${dh}%` }} />
          </div>
        )
      })}
    </div>
  )
}

function Table({ title, rows, empty }: { title: string; rows: { label: string; count: number }[]; empty?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface-raised p-4">
      <h3 className="text-xs uppercase tracking-widest text-text-tertiary mb-2">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-xs text-text-muted">{empty ?? 'Sin datos aún'}</p>
      ) : (
        <ul className="space-y-1">
          {rows.map((r) => (
            <li key={r.label} className="flex items-center gap-2 text-xs">
              <span className="truncate flex-1 text-text-secondary">{r.label}</span>
              <span className="tabular-nums font-medium">{r.count.toLocaleString('es-ES')}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default async function MetricsPage() {
  const m = await getAdminMetrics(30)

  if (!m) {
    return (
      <StubLike title="Métricas" message="Base de datos no disponible. Revisa la configuración de Turso." />
    )
  }

  const delta = m.today.devices - m.yesterday.devices

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold">Métricas</h1>
        <p className="text-xs text-text-tertiary mt-0.5">
          Dispositivos únicos anónimos · ventana de 30 días · generado{' '}
          {new Date(m.generatedAt).toLocaleString('es-ES')}
        </p>
      </header>

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Dispositivos hoy" value={m.today.devices} sub={`${m.today.views.toLocaleString('es-ES')} vistas`} />
        <Kpi
          label="Ayer"
          value={m.yesterday.devices}
          sub={delta === 0 ? '= ayer' : `${delta > 0 ? '▲' : '▼'} ${Math.abs(delta)} vs ayer`}
        />
        <Kpi label="Únicos 7 días" value={m.weekDevices} />
        <Kpi label="Únicos 30 días" value={m.monthDevices} />
      </section>

      <section className="rounded-2xl border border-border bg-surface-raised p-4">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-xs uppercase tracking-widest text-text-tertiary">Dispositivos únicos por día</h2>
          <span className="text-[10px] text-text-muted flex items-center gap-2">
            <span className="inline-block h-2 w-3 bg-accent rounded-sm" aria-hidden /> dispositivos
            <span className="inline-block h-2 w-3 bg-accent/25 rounded-sm" aria-hidden /> resto de vistas
          </span>
        </div>
        <Bars series={m.series} />
        <div className="grid grid-cols-2 mt-3 gap-3">
          <Table
            title="Nuevos vs recurrentes"
            rows={[
              { label: 'Nuevos (30d)', count: m.series.reduce((a, s) => a + s.newDevices, 0) },
              { label: 'Recurrentes (30d)', count: Math.max(0, m.monthDevices - m.series.reduce((a, s) => a + s.newDevices, 0)) },
            ]}
          />
          <Table title="Páginas más vistas" rows={m.topPaths} />
        </div>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        <Table title="Dispositivos (únicos)" rows={m.devices} />
        <Table title="Navegadores (únicos)" rows={m.browsers} />
        <Table title="Idioma/país (únicos)" rows={m.countries} />
        <Table title="Referentes" rows={m.referrers} />
        <Table title="Campañas (utm_source)" rows={m.utmSources} empty="Sin campañas etiquetadas" />
      </section>

      <p className="text-[11px] text-text-muted">
        Solo se cuentan visitantes que aceptaron las cookies analíticas
        (wthr_consent=granted). Datos brutos purgados a los 90 días tras
        el rollup diario.
      </p>
    </div>
  )
}

function StubLike({ title, message }: { title: string; message: string }) {
  return (
    <div className="space-y-2">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="text-sm text-text-tertiary">{message}</p>
    </div>
  )
}
