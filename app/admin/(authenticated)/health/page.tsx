'use client'

import { useQuery } from '@tanstack/react-query'

interface HealthCheck {
  ok: boolean
  checks: Record<string, { ok: boolean; detail?: string }>
  ts: number
}

export default function HealthPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'health'],
    queryFn: async () => {
      const r = await fetch('/api/health')
      return r.json() as Promise<HealthCheck>
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
