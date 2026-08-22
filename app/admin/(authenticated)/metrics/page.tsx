import { StubPage } from '@/components/admin/StubPage'
import { db } from '@/lib/db'

interface MetricsSummary {
  pageViews24h: number
  uniqueUsers24h: number
  events24h: number
}

async function fetchMetrics(): Promise<MetricsSummary> {
  const since = Date.now() - 24 * 60 * 60 * 1000
  try {
    const pv = await db.select<{ n: number }>('SELECT COUNT(*) AS n FROM page_views WHERE ts > ?', [since])
    const uniq = await db.select<{ n: number }>('SELECT COUNT(DISTINCT anon_id) AS n FROM page_views WHERE ts > ?', [since])
    const ev = await db.select<{ n: number }>('SELECT COUNT(*) AS n FROM events WHERE ts > ?', [since])
    return {
      pageViews24h: Number(pv[0]?.n ?? 0),
      uniqueUsers24h: Number(uniq[0]?.n ?? 0),
      events24h: Number(ev[0]?.n ?? 0),
    }
  } catch {
    return { pageViews24h: 0, uniqueUsers24h: 0, events24h: 0 }
  }
}

export default async function MetricsPage() {
  const m = await fetchMetrics()
  return (
    <StubPage
      title="Métricas"
      description="Tráfico, retención, funnels, cohortes, suscripciones y afiliados."
    >
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Kpi label="Page views 24h" value={m.pageViews24h} />
        <Kpi label="Usuarios únicos 24h" value={m.uniqueUsers24h} />
        <Kpi label="Eventos 24h" value={m.events24h} />
      </div>
      <p className="text-xs text-text-tertiary mt-2">
        Sprint 6 pendiente: cohortes, funnels, embudos, anomalías, gráficos avanzados.
      </p>
    </StubPage>
  )
}

function Kpi({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-border bg-surface-raised p-4">
      <div className="text-xs text-text-tertiary">{label}</div>
      <div className="text-2xl font-semibold mt-1">{value.toLocaleString('es-ES')}</div>
    </div>
  )
}
