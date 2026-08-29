'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Nombra las zonas que el panel acaba de pintar sin nombre.
 *
 * El panel es un componente de SERVIDOR y `lookupZoneNames` es lectura
 * pura: una celda sin entrada en `geo_names` se muestra tal cual
 * ("41.61,2.65"). Antes, ese nombre no llegaba hasta el cron de la noche
 * siguiente.
 *
 * Este componente cierra ese hueco DESPUÉS del render: pide resolver esas
 * celdas y refresca. La llamada al servicio externo la dispara el
 * navegador de quien administra, no el visitante — que es la razón por la
 * que se sacó del render en su día (hasta 20 s de TTFB con 5 fetch
 * secuenciales dentro de la página).
 *
 * Sólo se intenta UNA VEZ por montaje: si el proveedor no resuelve una
 * celda, `router.refresh()` volvería a pintarla sin nombre y se entraría
 * en un bucle de peticiones. El cron nocturno es quien reintenta.
 */
export default function ResolveZoneNames({ cells }: { cells: string[] }) {
  const router = useRouter()
  const yaIntentado = useRef(false)

  useEffect(() => {
    if (cells.length === 0 || yaIntentado.current) return
    yaIntentado.current = true

    let vivo = true
    void (async () => {
      try {
        const r = await fetch('/api/admin/zones/resolve', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ cells }),
        })
        const body = await r.json().catch(() => null)
        // Refrescar sólo si algo cambió: si no se resolvió ninguna, un
        // refresh no cambiaría nada y sólo gastaría un render.
        if (vivo && body?.ok && Object.keys(body.resueltas ?? {}).length > 0) {
          router.refresh()
        }
      } catch {
        /* sin nombres esta vez; lo reintenta el cron nocturno */
      }
    })()

    return () => { vivo = false }
  }, [cells, router])

  return null
}
