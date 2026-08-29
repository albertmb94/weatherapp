'use client'

import { useMutation, useQuery } from '@tanstack/react-query'

interface HealthCheck {
  ok: boolean
  checks: Record<string, { ok: boolean; detail?: string }>
  ts: number
}

interface RollupResult {
  ok: boolean
  days?: number
  purgedViews?: number
  purgeSkipped?: boolean
  reason?: string
}

interface Afectadas {
  pageViews: number
  breakdowns: number
  geoNames: number
}

const CLEANUP_URL = '/api/admin/cleanup/geo-null-island'

export default function HealthPage() {
  // AUDITORÍA: sin `isError`, y con un `r.json()` que lanza cuando la
  // respuesta no es JSON (un 502 del proxy, por ejemplo), la página se
  // quedaba PERMANENTEMENTE en blanco: ni datos, ni "cargando", ni
  // error. Justo la pantalla a la que se acude cuando algo va mal.
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['admin', 'health'],
    queryFn: async () => {
      const r = await fetch('/api/health')
      // El health devuelve 503 con cuerpo válido cuando algo está caído:
      // eso NO es un error de la consulta, es el dato que queremos.
      const body = await r.json().catch(() => null)
      if (!body) throw new Error(`Respuesta no interpretable (${r.status})`)
      return body as HealthCheck
    },
    refetchInterval: 30_000,
  })

  // Ejecución manual del rollup nocturno.
  //
  // Existe porque /api/cron/analytics-rollup sólo acepta el bearer de
  // CRON_SECRET: correcto para Vercel Cron, inútil para operar. Cuando esa
  // variable no llegó a definirse en producción, la consolidación estuvo
  // cuatro días parada y no había forma de lanzarla desde aquí. La ruta de
  // admin se autoriza con la SESIÓN, no con el secreto, así que este botón
  // funciona incluso cuando la variable falta — que es justo cuando hace
  // falta.
  const rollup = useMutation({
    mutationFn: async (): Promise<RollupResult> => {
      const r = await fetch('/api/admin/analytics-rollup', { method: 'POST' })
      const body = (await r.json().catch(() => null)) as RollupResult | null
      if (!body) throw new Error(`Respuesta no interpretable (${r.status})`)
      if (!body.ok) throw new Error(body.reason ?? `Falló con ${r.status}`)
      return body
    },
    // El resultado se refleja en checks.cron: se recarga para verlo.
    onSuccess: () => { void refetch() },
  })

  // Cuántas filas quedan atribuidas a Null Island (celda 0.00,0.00).
  // Sólo se pinta la sección cuando hay algo que limpiar, para que
  // desaparezca sola una vez aplicada.
  const nullIsland = useQuery({
    queryKey: ['admin', 'null-island'],
    queryFn: async (): Promise<Afectadas> => {
      const r = await fetch(CLEANUP_URL)
      const body = await r.json().catch(() => null)
      if (!body?.ok) throw new Error(`No se pudo consultar (${r.status})`)
      return body.afectadas as Afectadas
    },
  })

  const limpiar = useMutation({
    mutationFn: async (): Promise<Afectadas> => {
      const r = await fetch(CLEANUP_URL, { method: 'POST' })
      const body = await r.json().catch(() => null)
      if (!body?.ok) throw new Error(body?.error ?? `Falló con ${r.status}`)
      return body.aplicado as Afectadas
    },
    onSuccess: () => { void nullIsland.refetch() },
  })

  const hayQueLimpiar =
    nullIsland.data !== undefined &&
    nullIsland.data.pageViews + nullIsland.data.breakdowns + nullIsland.data.geoNames > 0

  return (
    <div className="p-6 space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Health</h1>
        <p className="text-sm text-text-tertiary">
          Estado de las dependencias. Refresco automático cada 30 s.
        </p>
      </header>
      {isLoading && <div className="text-sm text-text-tertiary">Cargando…</div>}
      {isError && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 space-y-2">
          <p className="text-sm text-red-500">
            No se pudo consultar el estado
            {error instanceof Error ? `: ${error.message}` : '.'}
          </p>
          <button
            type="button"
            onClick={() => refetch()}
            className="px-3 py-1 rounded-lg border border-border text-xs hover:bg-surface-raised"
          >
            Reintentar
          </button>
        </div>
      )}
      {data && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {Object.entries(data.checks).map(([name, c]) => (
            <div key={name} className="rounded-2xl border border-border bg-surface-raised p-4 flex items-center gap-3">
              <span className={`w-3 h-3 rounded-full ${c.ok ? 'bg-emerald-500' : 'bg-red-500'}`} />
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm capitalize">{name}</div>
                {c.detail && <div className="text-xs text-text-tertiary">{c.detail}</div>}
                {name === 'cron' && (
                  <div className="mt-2 space-y-1">
                    <button
                      type="button"
                      onClick={() => rollup.mutate()}
                      disabled={rollup.isPending}
                      className="px-2.5 py-1 rounded-lg border border-border text-xs hover:bg-surface disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {rollup.isPending ? 'Consolidando…' : 'Consolidar ahora'}
                    </button>
                    {rollup.isError && (
                      <p className="text-xs text-red-500 break-words">
                        {rollup.error instanceof Error ? rollup.error.message : 'Falló la consolidación'}
                      </p>
                    )}
                    {rollup.isSuccess && (
                      <p className="text-xs text-emerald-500 break-words">
                        {rollup.data.days ?? 0} día(s) consolidados
                        {rollup.data.purgeSkipped
                          ? ' · no se purgó nada'
                          : ` · ${rollup.data.purgedViews ?? 0} vista(s) purgadas`}
                      </p>
                    )}
                  </div>
                )}
              </div>
              <span className="text-xs text-text-tertiary">{c.ok ? 'OK' : 'DOWN'}</span>
            </div>
          ))}
        </div>
      )}
      {/* Sección de mantenimiento: sólo aparece si queda algo que hacer,
          así que se va sola en cuanto se aplica. */}
      {hayQueLimpiar && (
        <section className="rounded-2xl border border-amber-500/40 bg-amber-500/[0.06] p-4 space-y-2">
          <h2 className="text-sm font-medium">Visitas atribuidas a Null Island</h2>
          <p className="text-xs text-text-tertiary">
            Un fallo ya corregido guardaba la celda <code>0.00,0.00</code> —mitad del
            Atlántico— cuando la URL no llevaba coordenadas. Esto sanea lo ya escrito:
            a las visitas se les quita SÓLO la zona (no se borran, la visita fue real),
            y se eliminan el desglose por zona y el nombre cacheado.
          </p>
          <p className="text-xs text-text-tertiary">
            Afectadas: {nullIsland.data!.pageViews} visita(s) ·{' '}
            {nullIsland.data!.breakdowns} desglose(s) · {nullIsland.data!.geoNames} nombre(s).
          </p>
          <button
            type="button"
            onClick={() => limpiar.mutate()}
            disabled={limpiar.isPending}
            className="px-2.5 py-1 rounded-lg border border-border text-xs hover:bg-surface disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {limpiar.isPending ? 'Limpiando…' : 'Limpiar ahora'}
          </button>
          {limpiar.isError && (
            <p className="text-xs text-red-500 break-words">
              {limpiar.error instanceof Error ? limpiar.error.message : 'Falló la limpieza'}
            </p>
          )}
        </section>
      )}
      {limpiar.isSuccess && !hayQueLimpiar && (
        <p className="text-xs text-emerald-500">
          Null Island saneado: {limpiar.data.pageViews} visita(s) conservadas sin zona,{' '}
          {limpiar.data.breakdowns} desglose(s) y {limpiar.data.geoNames} nombre(s) borrados.
        </p>
      )}
      {data && <p className="text-xs text-text-tertiary">Última actualización: {new Date(data.ts).toLocaleTimeString()}</p>}
    </div>
  )
}
