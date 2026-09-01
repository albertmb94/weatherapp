'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Locale } from '@/lib/i18n'

/**
 * Aviso de "hay una versión nueva" con relevo del service worker.
 *
 * EL PROBLEMA QUE RESUELVE. `public/sw.js` acepta desde hace tiempo un
 * mensaje `SKIP_WAITING` para ceder el relevo al worker nuevo, y el
 * comentario del propio fichero decía «para que la app pueda ofrecer
 * "actualizar ahora" cuando quiera implementarlo». Nadie lo enviaba
 * nunca, y el registro de `app/layout.tsx` tampoco escuchaba
 * `updatefound`. Consecuencia: una pestaña abierta se quedaba con el
 * build viejo INDEFINIDAMENTE — sus chunks, su CSS y sus rutas de API—
 * hasta que la persona la cerrara. Con una app que la gente deja
 * abierta en una pestaña para mirar el tiempo, eso puede ser semanas.
 *
 * POR QUÉ NO SE ACTUALIZA SOLO. Sería tentador llamar a `SKIP_WAITING`
 * en cuanto hay versión nueva, pero eso recarga la página debajo de
 * quien la está usando: se perdería la ciudad buscada, la hora
 * seleccionada y el desplazamiento de la tabla. Se avisa y decide la
 * persona.
 *
 * DETALLE DEL CICLO DE VIDA QUE ES FÁCIL EQUIVOCAR. `controllerchange`
 * también se dispara la PRIMERA vez que se instala un worker, cuando
 * todavía no había controlador. Recargar ahí metería a todo visitante
 * nuevo en una recarga gratuita en su primera visita. Por eso sólo se
 * recarga si la petición de relevo ha salido de este componente.
 */

const TEXTOS: Record<Locale, { aviso: string; boton: string; descartar: string }> = {
  es: {
    aviso: 'Hay una versión nueva disponible.',
    boton: 'Actualizar',
    descartar: 'Descartar aviso de actualización',
  },
  en: {
    aviso: 'A new version is available.',
    boton: 'Update',
    descartar: 'Dismiss update notice',
  },
}

export default function AvisoActualizacion({ locale = 'es' }: { locale?: Locale }) {
  const [disponible, setDisponible] = useState(false)
  const [descartado, setDescartado] = useState(false)
  const [esperando, setEsperando] = useState<ServiceWorker | null>(null)
  /**
   * ¿Hemos pedido NOSOTROS el relevo?
   *
   * Va en un ref y no en estado porque lo lee el listener de
   * `controllerchange`, que se registra una sola vez dentro del efecto:
   * con estado leería el valor del render en que se registró, que
   * siempre sería `false`.
   */
  const relevoPedido = useRef(false)

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return

    let vivo = true
    let registro: ServiceWorkerRegistration | null = null

    const anunciar = (sw: ServiceWorker | null) => {
      if (!vivo || !sw) return
      setEsperando(sw)
      setDisponible(true)
    }

    // `ready` resuelve cuando ya hay un worker activo. Es justo la
    // condición que nos interesa: sin worker activo no hay "versión
    // vieja" de la que avisar, sólo una primera instalación.
    void navigator.serviceWorker.ready
      .then(reg => {
        if (!vivo) return
        registro = reg

        // Puede haber uno esperando desde antes de que montáramos.
        if (reg.waiting) anunciar(reg.waiting)

        reg.addEventListener('updatefound', () => {
          const nuevo = reg.installing
          if (!nuevo) return
          nuevo.addEventListener('statechange', () => {
            // `installed` + controlador existente = hay relevo pendiente.
            // Sin la segunda condición esto también saltaría en la
            // primera instalación de la vida.
            if (nuevo.state === 'installed' && navigator.serviceWorker.controller) {
              anunciar(nuevo)
            }
          })
        })
      })
      .catch(() => {})

    // Sólo recargamos si el relevo lo hemos pedido nosotros: ver la nota
    // del encabezado sobre la primera instalación.
    const alCambiarControlador = () => {
      if (!relevoPedido.current) return
      window.location.reload()
    }
    navigator.serviceWorker.addEventListener('controllerchange', alCambiarControlador)

    // Los navegadores buscan actualizaciones al navegar, y esta app es de
    // las que se quedan abiertas en una pestaña sin navegar nunca. Al
    // volver a ella se comprueba: es una petición condicional al mismo
    // origen, prácticamente gratis.
    const alVolver = () => {
      if (document.visibilityState === 'visible') registro?.update().catch(() => {})
    }
    document.addEventListener('visibilitychange', alVolver)

    return () => {
      vivo = false
      navigator.serviceWorker.removeEventListener('controllerchange', alCambiarControlador)
      document.removeEventListener('visibilitychange', alVolver)
    }
  }, [])

  const actualizar = useCallback(() => {
    relevoPedido.current = true
    esperando?.postMessage({ type: 'SKIP_WAITING' })
    // Si por lo que sea no llega `controllerchange` (un navegador que no
    // lo emita, un worker que no responda), la página no se queda
    // colgada esperando: se recarga igual pasado un momento.
    window.setTimeout(() => window.location.reload(), 1500)
  }, [esperando])

  if (!disponible || descartado) return null

  return (
    <div
      role="status"
      className="fixed bottom-20 sm:bottom-4 left-1/2 -translate-x-1/2 z-[2500] flex items-center gap-3 rounded-full border border-border bg-surface-raised px-4 py-2 shadow-xl"
    >
      <span className="text-xs text-text-secondary">{TEXTOS[locale].aviso}</span>
      <button
        onClick={actualizar}
        className="rounded-full bg-accent px-3 py-1 text-xs font-medium text-white hover:bg-accent-hover transition-colors"
      >
        {TEXTOS[locale].boton}
      </button>
      <button
        onClick={() => setDescartado(true)}
        aria-label={TEXTOS[locale].descartar}
        className="text-text-tertiary hover:text-text-primary text-sm leading-none px-1"
      >
        ×
      </button>
    </div>
  )
}
