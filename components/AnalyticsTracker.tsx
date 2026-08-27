'use client'

import { useEffect, useRef } from 'react'
import {
  EMIT_DEBOUNCE_MS,
  URL_CHANGE_EVENT,
  buildPageviewPayload,
  getTrackingContext,
  newCid,
  patchHistory,
  sendIngest,
  shouldEmit,
  trackedKey,
} from '@/lib/analytics/tracker'
import { readConsentFromBrowser } from '@/lib/trackingConsent'

/**
 * Emite un pageview al montar y en cada cambio de URL de la SPA.
 *
 * Se monta una sola vez, a nivel de layout, y no renderiza nada.
 */
export default function AnalyticsTracker() {
  const lastKey = useRef<string | null>(null)
  const enteredAt = useRef<number>(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingDuration = useRef<number | undefined>(undefined)

  useEffect(() => {
    if (typeof window === 'undefined') return
    patchHistory()

    const emit = (): void => {
      // El consentimiento se comprueba en cada emisión, no sólo al
      // montar: alguien puede aceptar (o revocar) sin recargar.
      if (readConsentFromBrowser() !== 'granted') return

      const ctx = getTrackingContext()
      const key = trackedKey(window.location.pathname, ctx)
      if (!shouldEmit(lastKey.current, key)) return

      const now = Date.now()
      // Duración de la página que se abandona, no de la que se abre.
      const duration = lastKey.current === null
        ? pendingDuration.current
        : now - enteredAt.current

      const payload = buildPageviewPayload({
        href: window.location.href,
        origin: window.location.origin,
        referrer: document.referrer,
        ctx,
        now,
        cid: newCid(),
        durationMs: duration,
      })

      lastKey.current = key
      enteredAt.current = now
      pendingDuration.current = undefined
      if (payload) sendIngest(payload)
    }

    const schedule = (): void => {
      if (timer.current) clearTimeout(timer.current)
      // El debounce (400 ms) supera al de useUrlState (300 ms): un cambio
      // de ciudad reescribe la URL varias veces mientras se asienta y sin
      // esto contaríamos 2-3 pageviews por una sola navegación.
      timer.current = setTimeout(emit, EMIT_DEBOUNCE_MS)
    }

    // Primer pageview: inmediato, sin esperar al debounce.
    emit()

    window.addEventListener(URL_CHANGE_EVENT, schedule)

    // Restauración desde bfcache: no hay montaje, sólo `pageshow`. Sin
    // esto, volver atrás desde otra web no contaría nunca.
    const onPageShow = (e: PageTransitionEvent): void => {
      if (!e.persisted) return
      lastKey.current = null
      emit()
    }
    window.addEventListener('pageshow', onPageShow)

    // Al ocultar la pestaña se cierra la medida de tiempo en página. Se
    // usa `visibilitychange` y no `unload`, que los navegadores modernos
    // no garantizan (y rompe el bfcache).
    const onHide = (): void => {
      if (document.visibilityState !== 'hidden') return
      pendingDuration.current = Date.now() - enteredAt.current
    }
    document.addEventListener('visibilitychange', onHide)

    return () => {
      if (timer.current) clearTimeout(timer.current)
      window.removeEventListener(URL_CHANGE_EVENT, schedule)
      window.removeEventListener('pageshow', onPageShow)
      document.removeEventListener('visibilitychange', onHide)
    }
  }, [])

  return null
}
