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

/** B-NBT-12: gráfico SVG con matemática de píxeles explícita. La
 *  versión CSS (alturas % apiladas en flex) colapsaba a 0px según el
 *  viewport y se veía vacío aunque hubiera datos. */
function Bars({ series }: { series: { date: string; devices: number; views: number }[] }) {
  const W = 720
  const H = 160
  const PAD = 2
  const max = Math.max(1, ...series.map(s => s.views))
  const n = Math.max(1, series.length)
  const slot = W / n
  const barW = Math.max(3, Math.floor(slot * 0.62))

  const hasAny = series.some(s => s.views > 0)
  if (!hasAny) {
    return (
      <p className="text-xs text-text-muted h-40 mt-2 flex items-center justify-center">
        Sin visitas registradas en los últimos 30 días.
      </p>
    )
  }

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="w-full h-40 mt-2"
      role="img"
      aria-label="Dispositivos únicos por día (30 días)"
    >
      {series.map((s, i) => {
        const vh = Math.max(2, Math.round((s.views / max) * (H - PAD)))
        const dh = Math.max(2, Math.round((s.devices / Math.max(1, s.views)) * vh))
        const x = i * slot + (slot - barW) / 2
        return (
          <g key={s.date}>
            <title>{`${s.date}: ${s.devices} dispositivos / ${s.views} vistas`}</title>
            {/* resto de vistas (gris claro) detrás */}
            <rect x={x} y={H - vh} width={barW} height={vh - dh} rx={1} fill="rgba(148,163,184,0.35)" />
            {/* dispositivos únicos (acento) delante */}
            <rect x={x} y={H - dh} width={barW} height={dh} rx={1} fill="var(--accent, #0a7aff)" />
          </g>
        )
      })}
    </svg>
  )
}

function ZoneTable({ zones }: { zones: { label: string; devices: number; views: number }[] }) {
  return (
    <div className="rounded-2xl border border-border bg-surface-raised p-4">
      <h3 className="text-xs uppercase tracking-widest text-text-tertiary mb-2">Zonas / ciudades</h3>
      {zones.length === 0 ? (
        <p className="text-xs text-text-muted">
          Sin datos de zona todavía — se registran cuando la visita lleva
          coordenadas en la URL (ciudad seleccionada).
        </p>
      ) : (
        <ul className="space-y-1">
          {zones.map((z) => (
            <li key={z.label} className="flex items-center gap-2 text-xs">
              <span className="truncate flex-1 text-text-secondary">📍 {z.label}</span>
              <span className="tabular-nums font-medium" title={`${z.views} vistas`}>
                {z.devices.toLocaleString('es-ES')}
              </span>
            </li>
          ))}
        </ul>
      )}
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

      <section className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Kpi label="Dispositivos hoy" value={m.today.devices} sub={`${m.today.views.toLocaleString('es-ES')} vistas`} />
        <Kpi
          label="Ayer"
          value={m.yesterday.devices}
          sub={delta === 0 ? '= ayer' : `${delta > 0 ? '▲' : '▼'} ${Math.abs(delta)} vs ayer`}
        />
        <Kpi label="Sesiones hoy" value={m.sessionsToday} sub="un dispositivo ≈ N sesiones" />
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
        <div className="grid grid-cols-1 sm:grid-cols-3 mt-3 gap-3">
          <Table
            title="Nuevos vs recurrentes"
            rows={[
              { label: 'Nuevos (30d)', count: m.series.reduce((a, s) => a + s.newDevices, 0) },
              { label: 'Recurrentes (30d)', count: Math.max(0, m.monthDevices - m.series.reduce((a, s) => a + s.newDevices, 0)) },
            ]}
          />
          <Table title="Páginas más vistas" rows={m.topPaths} empty="Sin páginas (solo tráfico de API)" />
          <ZoneTable zones={m.zones} />
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
