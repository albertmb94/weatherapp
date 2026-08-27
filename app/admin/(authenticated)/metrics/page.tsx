import { getAdminMetrics } from '@/lib/analytics'

export const dynamic = 'force-dynamic'

/* ── KPI card ───────────────────────────────────────────────────────── */

function Kpi({ label, value, sub, accent }: {
  label: string; value: string | number; sub?: string; accent?: boolean
}) {
  return (
    <div className={`rounded-2xl border p-4 ${accent ? 'border-accent/40 bg-accent/[0.04]' : 'border-border bg-surface-raised'}`}>
      <div className="text-xs text-text-tertiary">{label}</div>
      <div className="text-3xl font-bold mt-1 tabular-nums">
        {typeof value === 'number' ? value.toLocaleString('es-ES') : value}
      </div>
      {sub ? <div className="text-[11px] text-text-muted mt-0.5">{sub}</div> : null}
    </div>
  )
}

/* ── SVG bar chart ──────────────────────────────────────────────────── */

function DeviceChart({ series }: { series: { date: string; devices: number; views: number }[] }) {
  const W = 720
  const H = 180
  const max = Math.max(1, ...series.map(s => s.views))
  const n = Math.max(1, series.length)
  const slot = W / n
  const barW = Math.max(4, Math.floor(slot * 0.6))

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-44"
      role="img" aria-label="Dispositivos únicos por día (30 días)">
      {series.map((s, i) => {
        const vh = Math.max(s.views > 0 ? 3 : 0, Math.round((s.views / max) * (H - 8)))
        const dh = Math.max(s.devices > 0 ? 3 : 0, Math.round((s.devices / max) * vh))
        const x = i * slot + (slot - barW) / 2
        return (
          <g key={s.date}>
            <title>{`${s.date}: ${s.devices} dispositivos / ${s.views} vistas`}</title>
            <rect x={x} y={H - vh} width={barW} height={vh} rx={2} fill="rgba(148,163,184,0.3)" />
            <rect x={x} y={H - dh} width={barW} height={dh} rx={2} className="fill-accent" />
          </g>
        )
      })}
    </svg>
  )
}

/* ── Zonas / ciudades ──────────────────────────────────────────────── */

function ZoneList({ zones }: { zones: { label: string; devices: number; views: number }[] }) {
  const max = Math.max(1, ...zones.map(z => z.devices))
  return (
    <div className="rounded-2xl border border-border bg-surface-raised p-4">
      <h3 className="text-xs uppercase tracking-widest text-text-tertiary mb-3">📍 Ciudades consultadas</h3>
      {zones.length === 0 ? (
        <p className="text-xs text-text-muted">Sin datos de zona aún.</p>
      ) : (
        <ul className="space-y-2">
          {zones.map(z => (
            <li key={z.label} className="text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-medium text-text-primary">{z.label}</span>
                <span className="tabular-nums text-text-secondary">{z.devices} disp</span>
              </div>
              <div className="h-[3px] rounded-full bg-accent/25 mt-1">
                <div className="h-full rounded-full bg-accent/60" style={{ width: `${Math.round((z.devices / max) * 100)}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/* ── Desktop vs Mobile split ────────────────────────────────────────── */

function DeviceSplit({ devices }: { devices: { label: string; count: number }[] }) {
  const filtered = devices.filter(d => d.label)
  const total = filtered.reduce((a, d) => a + d.count, 0)
  if (total === 0) return null
  const ICONS: Record<string, string> = { mobile: '📱', tablet: '📋', desktop: '💻' }
  return (
    <div className="rounded-2xl border border-border bg-surface-raised p-4">
      <h3 className="text-xs uppercase tracking-widest text-text-tertiary mb-3">Desktop vs Mobile</h3>
      <div className="flex h-6 rounded-lg overflow-hidden gap-0.5">
        {filtered.map(d => (
          <div key={d.label}
            className="flex items-center justify-center text-[10px] text-white"
            style={{ width: `${(d.count / total) * 100}%`, backgroundColor: d.label === 'mobile' ? '#818cf8' : d.label === 'tablet' ? '#f59e0b' : '#34d399' }}
            title={`${d.label}: ${d.count}`}
          >
            {(ICONS[d.label] ?? '')}
          </div>
        ))}
      </div>
      <ul className="mt-2 space-y-0.5">
        {filtered.map(d => (
          <li key={d.label} className="flex items-center justify-between text-xs text-text-secondary">
            <span>{d.label}</span>
            <span className="tabular-nums">{d.count.toLocaleString('es-ES')}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ── Tabla genérica con barra proporcional ─────────────────────────── */

function Table({ title, rows, empty }: { title: string; rows: { label: string; count: number }[]; empty?: string }) {
  const max = Math.max(1, ...rows.map(r => r.count))
  return (
    <div className="rounded-2xl border border-border bg-surface-raised p-4">
      <h3 className="text-xs uppercase tracking-widest text-text-tertiary mb-2">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-xs text-text-muted">{empty ?? 'Sin datos aún'}</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map(r => (
            <li key={r.label} className="text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate flex-1 text-text-secondary">{r.label}</span>
                <span className="tabular-nums font-medium">{r.count.toLocaleString('es-ES')}</span>
              </div>
              <div className="h-[3px] rounded-full bg-accent/20 mt-0.5">
                <div className="h-full rounded-full bg-accent/60" style={{ width: `${Math.round((r.count / max) * 100)}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
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

/* ── Página principal ──────────────────────────────────────────────── */

export default async function MetricsPage() {
  const m = await getAdminMetrics(30)

  if (!m) {
    return <StubLike title="Métricas" message="Base de datos no disponible." />
  }

  const delta = m.today.devices - m.yesterday.devices

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold">Métricas</h1>
        <p className="text-xs text-text-tertiary mt-0.5">
          Dispositivos únicos · generado {new Date(m.generatedAt).toLocaleString('es-ES')}
        </p>
      </header>

      {/* KPIs */}
      <section className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Kpi accent label="Dispositivos hoy" value={m.today.devices} sub={`${m.today.views.toLocaleString('es-ES')} vistas`} />
        <Kpi label="Ayer" value={m.yesterday.devices}
          sub={delta === 0 ? '= ayer' : `${delta > 0 ? '▲' : '▼'} ${Math.abs(delta)} vs ayer`} />
        <Kpi label="Sesiones hoy" value={m.sessionsToday} />
        <Kpi label="Únicos 7 días" value={m.weekDevices} />
        <Kpi label="Únicos 30 días" value={m.monthDevices} />
      </section>

      {/* Gráfico */}
      <section className="rounded-2xl border border-border bg-surface-raised p-4">
        <h2 className="text-xs uppercase tracking-widest text-text-tertiary mb-1">Dispositivos únicos por día</h2>
        <DeviceChart series={m.series} />
      </section>

      {/* Zonas + Desktop/Mobile */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ZoneList zones={m.zones} />
        <DeviceSplit devices={m.devices} />
      </section>

      {/* Navegadores + Nuevos/Recurrentes */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Table title="Navegadores (únicos)" rows={m.browsers} />
        <Table
          title="Nuevos vs recurrentes (30d)"
          rows={[
            { label: 'Nuevos', count: m.series.reduce((a, s) => a + s.newDevices, 0) },
            { label: 'Recurrentes', count: Math.max(0, m.monthDevices - m.series.reduce((a, s) => a + s.newDevices, 0)) },
          ]}
        />
      </section>

      <p className="text-[11px] text-text-muted">
        Solo visitantes que aceptaron cookies analíticas. Datos brutos purgados a los 90 días.
      </p>
    </div>
  )
}
