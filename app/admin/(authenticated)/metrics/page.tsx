import Link from 'next/link'
import { getAdminMetrics, parseRange, ALLOWED_RANGES, type DailyPoint } from '@/lib/analytics'
import { celdaValida } from '@/lib/analytics/geoCell'
import ResolveZoneNames from '@/components/admin/ResolveZoneNames'

export const dynamic = 'force-dynamic'

/**
 * Panel de métricas.
 *
 * Conserva el rediseño de B-NBT-24 (gráfico SVG, barras proporcionales,
 * split escritorio/móvil) y lo conecta al contrato de datos nuevo:
 * selector de rango, estados de error reales y desgloses que cuentan
 * VISTAS en vez de "únicos" que nunca fueron distintos en el rango.
 */

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

function DeviceChart({ series, rangeDays }: { series: DailyPoint[]; rangeDays: number }) {
  const W = 720
  const H = 180
  const max = Math.max(1, ...series.map(s => s.views))
  const n = Math.max(1, series.length)
  const slot = W / n
  const barW = Math.max(4, Math.floor(slot * 0.6))

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-44"
      role="img" aria-label={`Dispositivos únicos por día (${rangeDays} días)`}>
      {series.map((s, i) => {
        const vh = Math.max(s.views > 0 ? 3 : 0, Math.round((s.views / max) * (H - 8)))
        // Ambas series se escalan contra el MISMO máximo. Antes la barra
        // de dispositivos usaba `(devices / views) * vh`, un ratio de un
        // ratio: no era comparable entre días y el gráfico mentía.
        const dh = Math.min(vh, Math.max(s.devices > 0 ? 3 : 0, Math.round((s.devices / max) * (H - 8))))
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

function ZoneList({ zones }: { zones: { label: string; views: number }[] }) {
  const max = Math.max(1, ...zones.map(z => z.views))
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
                <span className="tabular-nums text-text-secondary">{z.views.toLocaleString('es-ES')} vistas</span>
              </div>
              <div className="h-[3px] rounded-full bg-accent/25 mt-1">
                <div className="h-full rounded-full bg-accent/60" style={{ width: `${Math.round((z.views / max) * 100)}%` }} />
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
  const filtered = devices.filter(d => d.label && d.label !== '(desconocido)')
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

/* ── Selector de rango, sin una línea de JS de cliente ───────────────── */

function RangePicker({ current }: { current: number }) {
  return (
    <div className="flex gap-1" role="group" aria-label="Ventana temporal">
      {ALLOWED_RANGES.map(r => (
        <Link
          key={r}
          href={`?range=${r}`}
          scroll={false}
          aria-current={r === current ? 'true' : undefined}
          className={
            r === current
              ? 'px-2.5 py-1 rounded-lg text-xs font-medium bg-accent text-white'
              : 'px-2.5 py-1 rounded-lg text-xs text-text-secondary border border-border hover:bg-surface-raised'
          }
        >
          {r}d
        </Link>
      ))}
    </div>
  )
}

function StubLike({ title, message, detail }: { title: string; message: string; detail?: string }) {
  return (
    <div className="space-y-2">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="text-sm text-text-tertiary">{message}</p>
      {detail ? (
        <pre className="text-[11px] text-text-muted whitespace-pre-wrap bg-surface-raised border border-border rounded-lg p-2 overflow-x-auto">
          {detail}
        </pre>
      ) : null}
    </div>
  )
}

const MENSAJES_ERROR: Record<string, string> = {
  not_configured:
    'No hay base de datos configurada en este entorno. Define TURSO_DATABASE_URL (o DB_ALLOW_FILE_IN_PRODUCTION=1 en self-hosted).',
  query_failed:
    'La base de datos respondió con un error al consultar las métricas. Revisa los logs del servidor.',
  schema_pending:
    'Hay migraciones de esquema pendientes o fallidas. Compruébalo en /admin/health o ejecútalas desde /api/admin/migrate.',
}

/* ── Página principal ──────────────────────────────────────────────── */

export default async function MetricsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>
}) {
  const rangeDays = parseRange((await searchParams).range)
  const result = await getAdminMetrics(rangeDays)

  // Antes esto era `if (!m)`, y `getAdminMetrics` no podía devolver null
  // porque `db.select` se tragaba los errores: una tabla ausente se veía
  // como "0 dispositivos", idéntico a un día tranquilo. Ésa es la razón
  // de que el apagón de analytics durase meses sin que nadie lo notara.
  if (!result.ok) {
    return (
      <StubLike
        title="Métricas"
        message={MENSAJES_ERROR[result.error] ?? 'Error desconocido al cargar las métricas.'}
        detail={result.detail}
      />
    )
  }

  const m = result.metrics
  const delta = m.today.devices - m.yesterday.devices
  const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`)

  return (
    <div className="space-y-5">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold">Métricas</h1>
          <p className="text-xs text-text-tertiary mt-0.5">
            Dispositivos únicos · ventana de {m.rangeDays} días · hora de Madrid ·
            generado {new Date(m.generatedAt).toLocaleString('es-ES')}
          </p>
        </div>
        <RangePicker current={m.rangeDays} />
      </header>

      {m.warnings.length > 0 ? (
        // Estado PARCIAL: datos reales + aviso, en vez de tumbar la página
        // entera o —peor— fingir que todo va bien.
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2">
          <ul className="text-xs text-amber-700 dark:text-amber-300 space-y-0.5">
            {m.warnings.map(w => <li key={w}>⚠ {w}</li>)}
          </ul>
        </div>
      ) : null}

      {/* KPIs */}
      <section className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Kpi accent label="Dispositivos hoy" value={m.today.devices} sub={`${m.today.views.toLocaleString('es-ES')} vistas`} />
        <Kpi label="Ayer" value={m.yesterday.devices}
          sub={delta === 0 ? '= ayer' : `${delta > 0 ? '▲' : '▼'} ${Math.abs(delta)} vs ayer`} />
        <Kpi label="Sesiones hoy" value={m.sessionsToday} />
        <Kpi label="Únicos 7 días" value={m.weekDevices} />
        <Kpi label={`Únicos ${m.rangeDays} días`} value={m.rangeDevices} />
      </section>

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label={`Sesiones ${m.rangeDays}d`} value={m.sessionsRange} />
        <Kpi label="Vistas por sesión" value={m.viewsPerSession === null ? '—' : m.viewsPerSession.toFixed(1)} />
        <Kpi label="Rebote" value={pct(m.bounceRate)} sub="sesiones de una sola vista" />
        <Kpi
          label="Nuevos / recurrentes"
          value={`${m.rangeNew.toLocaleString('es-ES')} / ${m.rangeReturning.toLocaleString('es-ES')}`}
          sub={`suma = ${m.rangeDevices.toLocaleString('es-ES')} únicos`}
        />
      </section>

      {/* Gráfico */}
      <section className="rounded-2xl border border-border bg-surface-raised p-4">
        <h2 className="text-xs uppercase tracking-widest text-text-tertiary mb-1">Dispositivos únicos por día</h2>
        <DeviceChart series={m.series} rangeDays={m.rangeDays} />
      </section>

      {/* Zonas + Desktop/Mobile */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ZoneList zones={m.zones} />
        {/* Las zonas sin nombre se muestran con sus coordenadas. Esto las
            nombra DESPUÉS del render: la llamada al geocodificador la
            hace el navegador de admin, no el visitante. Ver el comentario
            del componente. */}
        <ResolveZoneNames
          cells={m.zones.map(z => celdaValida(z.label)).filter((c): c is string => c !== null)}
        />
        <DeviceSplit devices={m.devices} />
      </section>

      {/* Páginas + Navegadores */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Table title="Páginas más vistas" rows={m.topPaths} empty="Sin páginas registradas" />
        <Table title="Navegadores" rows={m.browsers} />
      </section>

      {/* País, idioma, referentes y campañas */}
      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <Table title="País (IP)" rows={m.countries} empty="Sin geolocalización disponible" />
        <Table title="Idioma del navegador" rows={m.locales} />
        <Table title="Referentes" rows={m.referrers} />
        <Table title="Campañas (utm_source)" rows={m.utmSources} empty="Sin campañas etiquetadas" />
      </section>

      <p className="text-[11px] text-text-muted">
        Los desgloses cuentan <strong>vistas</strong> (que sí son sumables entre
        días); los KPI de arriba cuentan <strong>dispositivos únicos</strong>. Solo
        visitantes que aceptaron cookies analíticas. Datos brutos purgados a los
        90 días, después de consolidarse. Los bloqueadores de anuncios impiden
        parte de la medición, así que el recuento real es algo mayor.
      </p>
    </div>
  )
}
