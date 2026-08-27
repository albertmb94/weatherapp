import Link from 'next/link'
import { getAdminMetrics, parseRange, ALLOWED_RANGES, type DailyPoint } from '@/lib/analytics'

export const dynamic = 'force-dynamic'

/** Panel de visitantes: serie diaria, nuevos vs recurrentes,
 *  dispositivos/navegadores/países, páginas, referentes y campañas.
 *  Server component que lee lib/analytics directamente — la autenticación
 *  la impone el layout (authenticated). */

function Kpi({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface-raised p-4">
      <div className="text-xs text-text-tertiary">{label}</div>
      <div className="text-2xl font-semibold mt-1 tabular-nums">
        {typeof value === 'number' ? value.toLocaleString('es-ES') : value}
      </div>
      {sub ? <div className="text-[11px] text-text-muted mt-0.5">{sub}</div> : null}
    </div>
  )
}

/** B-NBT-12: gráfico SVG con matemática de píxeles explícita. La
 *  versión CSS (alturas % apiladas en flex) colapsaba a 0px según el
 *  viewport y se veía vacío aunque hubiera datos. */
function Bars({ series, rangeDays }: { series: DailyPoint[]; rangeDays: number }) {
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
        Sin visitas registradas en los últimos {rangeDays} días.
      </p>
    )
  }

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="w-full h-40 mt-2"
      role="img"
      aria-label={`Dispositivos únicos por día (${rangeDays} días)`}
    >
      {series.map((s, i) => {
        const vh = Math.max(2, Math.round((s.views / max) * (H - PAD)))
        // Auditoría: antes era `(s.devices / max(1, s.views)) * vh`, es
        // decir un ratio de un ratio — la barra de dispositivos no era
        // comparable entre días y el gráfico mentía. Ambas series se
        // escalan ahora contra el MISMO máximo.
        const dh = Math.min(vh, Math.max(2, Math.round((s.devices / max) * (H - PAD))))
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

function ZoneTable({ zones }: { zones: { label: string; views: number }[] }) {
  return (
    <div className="rounded-2xl border border-border bg-surface-raised p-4">
      <h3 className="text-xs uppercase tracking-widest text-text-tertiary mb-2">Zonas / ciudades</h3>
      {zones.length === 0 ? (
        <p className="text-xs text-text-muted">
          Sin datos de zona todavía. Se registran cuando la visita lleva
          ciudad seleccionada.
        </p>
      ) : (
        <ul className="space-y-1">
          {zones.map(z => (
            <li key={z.label} className="flex items-center gap-2 text-xs">
              <span className="truncate flex-1 text-text-secondary">📍 {z.label}</span>
              <span className="tabular-nums font-medium">{z.views.toLocaleString('es-ES')}</span>
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
          {rows.map(r => (
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

/** Selector de rango sin una línea de JavaScript de cliente: son
 *  enlaces, y la página ya es force-dynamic. */
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

const MENSAJES_ERROR: Record<string, string> = {
  not_configured:
    'No hay base de datos configurada en este entorno. Define TURSO_DATABASE_URL (o DB_ALLOW_FILE_IN_PRODUCTION=1 en self-hosted).',
  query_failed:
    'La base de datos respondió con un error al consultar las métricas. Revisa los logs del servidor.',
  schema_pending:
    'Hay migraciones de esquema pendientes o fallidas. Compruébalo en /admin/health o ejecútalas desde /api/admin/migrate.',
}

export default async function MetricsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>
}) {
  const rangeDays = parseRange((await searchParams).range)
  const result = await getAdminMetrics(rangeDays)

  // Auditoría: antes esto era `if (!m)`, y `getAdminMetrics` no podía
  // devolver null porque `db.select` se tragaba los errores. Una tabla
  // inexistente se veía como "0 dispositivos", idéntico a un día
  // tranquilo. Esa es exactamente la razón de que el apagón durase meses.
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
            Dispositivos únicos anónimos · ventana de {m.rangeDays} días · hora de Madrid ·
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
            {m.warnings.map(w => (
              <li key={w}>⚠ {w}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <section className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Kpi
          label="Dispositivos hoy"
          value={m.today.devices}
          sub={`${m.today.views.toLocaleString('es-ES')} vistas`}
        />
        <Kpi
          label="Ayer"
          value={m.yesterday.devices}
          sub={delta === 0 ? '= ayer' : `${delta > 0 ? '▲' : '▼'} ${Math.abs(delta)} vs ayer`}
        />
        <Kpi label="Sesiones hoy" value={m.sessionsToday} sub="un dispositivo ≈ N sesiones" />
        <Kpi label="Únicos 7 días" value={m.weekDevices} />
        <Kpi label={`Únicos ${m.rangeDays} días`} value={m.rangeDevices} />
      </section>

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label={`Sesiones ${m.rangeDays}d`} value={m.sessionsRange} />
        <Kpi
          label="Vistas por sesión"
          value={m.viewsPerSession === null ? '—' : m.viewsPerSession.toFixed(1)}
        />
        <Kpi label="Rebote" value={pct(m.bounceRate)} sub="sesiones de una sola vista" />
        <Kpi
          label="Nuevos vs recurrentes"
          value={`${m.rangeNew.toLocaleString('es-ES')} / ${m.rangeReturning.toLocaleString('es-ES')}`}
          sub={`suma = ${m.rangeDevices.toLocaleString('es-ES')} únicos`}
        />
      </section>

      <section className="rounded-2xl border border-border bg-surface-raised p-4">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-xs uppercase tracking-widest text-text-tertiary">
            Dispositivos únicos por día
          </h2>
          <span className="text-[10px] text-text-muted flex items-center gap-2">
            <span className="inline-block h-2 w-3 bg-accent rounded-sm" aria-hidden /> dispositivos
            <span className="inline-block h-2 w-3 bg-accent/25 rounded-sm" aria-hidden /> resto de vistas
          </span>
        </div>
        <Bars series={m.series} rangeDays={m.rangeDays} />
        <div className="grid grid-cols-1 sm:grid-cols-3 mt-3 gap-3">
          <Table
            title="Nuevos vs recurrentes"
            rows={[
              { label: `Nuevos (${m.rangeDays}d)`, count: m.rangeNew },
              { label: `Recurrentes (${m.rangeDays}d)`, count: m.rangeReturning },
            ]}
          />
          <Table title="Páginas más vistas" rows={m.topPaths} empty="Sin páginas registradas" />
          <ZoneTable zones={m.zones} />
        </div>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        <Table title="Dispositivos" rows={m.devices} />
        <Table title="Navegadores" rows={m.browsers} />
        <Table title="País (IP)" rows={m.countries} empty="Sin geolocalización disponible" />
        <Table title="Idioma del navegador" rows={m.locales} />
        <Table title="Referentes" rows={m.referrers} />
        <Table title="Campañas (utm_source)" rows={m.utmSources} empty="Sin campañas etiquetadas" />
      </section>

      <p className="text-[11px] text-text-muted">
        Los desgloses cuentan <strong>vistas</strong> (que sí son sumables entre
        días); los KPI de arriba cuentan <strong>dispositivos únicos</strong>. Solo
        se registran visitantes que aceptaron las cookies analíticas. Los datos
        brutos se purgan a los 90 días, después de consolidarse. Los
        bloqueadores de anuncios impiden parte de la medición, así que el
        recuento real es algo mayor.
      </p>
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
