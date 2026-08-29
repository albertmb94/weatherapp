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
import { CONSENT_CHANGE_EVENT, readConsentFromBrowser } from '@/lib/trackingConsent'

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

    // Aceptar el consentimiento ES el momento en que empieza a poder
    // contarse la visita. Sin esto, quien aceptaba y se iba sin volver a
    // cargar el documento no aparecía JAMÁS: el `emit()` del montaje ya
    // había salido de vacío por falta de permiso y nada volvía a
    // intentarlo. Ver CONSENT_CHANGE_EVENT en lib/trackingConsent.ts.
    //
    // NO se reinicia `lastKey`: `emit()` sale por falta de permiso ANTES
    // de registrar clave, así que tras un intento fallido sigue en null y
    // esta emisión ya cuenta como la primera. Reiniciarlo saltaba el
    // dedupe y duplicaba la visita cada vez que alguien reafirmaba su
    // elección — el centro de preferencias al volver a guardar, o
    // Cookiebot disparando OnConsentReady y OnAccept por una sola
    // decisión.
    const onConsentChange = (): void => {
      if (readConsentFromBrowser() !== 'granted') return
      emit()
    }
    window.addEventListener(CONSENT_CHANGE_EVENT, onConsentChange)

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
      window.removeEventListener(CONSENT_CHANGE_EVENT, onConsentChange)
      document.removeEventListener('visibilitychange', onHide)
    }
  }, [])

  return null
}
