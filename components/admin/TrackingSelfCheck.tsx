'use client'

import { useQuery } from '@tanstack/react-query'

interface Respuesta {
  ok: boolean
  navegador: {
    consentimiento: 'granted' | 'rejected' | null
    tieneIdentidad: boolean
    tieneSesion: boolean
    seRegistra: boolean
  }
  esteDispositivo: { vistasHoy: number; ultima: number | null } | null
  sitio: { vistasHoy: number; dispositivosHoy: number; ultima: number | null } | null
  bootstrapProxy: boolean
}

function hora(ts: number | null): string {
  if (!ts) return '—'
  return new Date(ts).toLocaleString('es-ES')
}

/**
 * Responde "¿por qué no aparecen MIS visitas?" sin adivinar.
 *
 * Hay razones legítimas para no contar a alguien —no ha aceptado el
 * banner, un bloqueador corta la petición, el navegador arrastra una
 * versión antigua— y desde el panel todas son indistinguibles de un
 * fallo. El servidor, en cambio, sabe qué cookies trae ESTA petición:
 * basta con preguntárselo desde el mismo navegador con el que se navega.
 */
export default function TrackingSelfCheck() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin', 'tracking-selfcheck'],
    queryFn: async (): Promise<Respuesta> => {
      const r = await fetch('/api/admin/tracking-selfcheck')
      const body = await r.json().catch(() => null)
      if (!body?.ok) throw new Error(`No se pudo consultar (${r.status})`)
      return body as Respuesta
    },
  })

  return (
    <section className="rounded-2xl border border-border bg-surface-raised p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium">¿Se están contando mis visitas?</h2>
        <button
          type="button"
          onClick={() => refetch()}
          className="px-2.5 py-1 rounded-lg border border-border text-xs hover:bg-surface"
        >
          Recomprobar
        </button>
      </div>

      {isLoading && <p className="text-xs text-text-tertiary">Comprobando…</p>}
      {isError && <p className="text-xs text-red-500">No se pudo comprobar.</p>}

      {data && (
        <>
          {/* El veredicto, en una frase y con la acción que toca. */}
          {data.navegador.seRegistra ? (
            <p className="text-xs text-emerald-500">
              Sí. Este navegador aceptó el banner y sus visitas se registran
              {data.esteDispositivo
                ? ` — ${data.esteDispositivo.vistasHoy} hoy (última: ${hora(data.esteDispositivo.ultima)}).`
                : '.'}
              {data.esteDispositivo?.vistasHoy === 0 && (
                <>
                  {' '}Si has navegado y sigue en 0, lo más probable es un bloqueador
                  cortando <code>/api/ingest</code>, o una versión antigua en caché:
                  prueba con Ctrl+Shift+R.
                </>
              )}
            </p>
          ) : (
            <p className="text-xs text-amber-500">
              No.{' '}
              {data.navegador.consentimiento === 'rejected'
                ? 'Este navegador RECHAZÓ el banner, así que sus visitas no se cuentan — es el comportamiento correcto.'
                : 'Este navegador no ha respondido al banner de consentimiento, así que sus visitas no se cuentan. Acéptalo en la web y vuelve a probar.'}
            </p>
          )}

          <ul className="space-y-1 text-xs">
            <li className="flex justify-between gap-2">
              <span className="text-text-secondary">Consentimiento de este navegador</span>
              <span className="text-text-primary">{data.navegador.consentimiento ?? 'sin responder'}</span>
            </li>
            <li className="flex justify-between gap-2">
              <span className="text-text-secondary">Identidad anónima</span>
              <span className="text-text-primary">{data.navegador.tieneIdentidad ? 'sí' : 'no'}</span>
            </li>
            {data.sitio && (
              <>
                <li className="flex justify-between gap-2">
                  <span className="text-text-secondary">Vistas hoy (todo el sitio)</span>
                  <span className="tabular-nums text-text-primary">{data.sitio.vistasHoy}</span>
                </li>
                <li className="flex justify-between gap-2">
                  <span className="text-text-secondary">Dispositivos hoy</span>
                  <span className="tabular-nums text-text-primary">{data.sitio.dispositivosHoy}</span>
                </li>
                <li className="flex justify-between gap-2">
                  <span className="text-text-secondary">Última visita registrada</span>
                  <span className="text-text-primary">{hora(data.sitio.ultima)}</span>
                </li>
              </>
            )}
          </ul>

          {!data.bootstrapProxy && (
            <p className="text-[10px] leading-relaxed text-text-muted">
              <code>TRACK_INTERNAL_SECRET</code> no está definida: el proxy no registra la
              sesión de quien tiene JavaScript bloqueado. No afecta al camino normal, pero
              esas visitas no se cuentan.
            </p>
          )}
        </>
      )}
    </section>
  )
}
