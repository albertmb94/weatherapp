'use client'

import { useQuery } from '@tanstack/react-query'

interface HealthCheck {
  ok: boolean
  checks: Record<string, { ok: boolean; detail?: string }>
  ts: number
}

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
              </div>
              <span className="text-xs text-text-tertiary">{c.ok ? 'OK' : 'DOWN'}</span>
            </div>
          ))}
        </div>
      )}
      {data && <p className="text-xs text-text-tertiary">Última actualización: {new Date(data.ts).toLocaleTimeString()}</p>}
    </div>
  )
}
