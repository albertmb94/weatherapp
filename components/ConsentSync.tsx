'use client'

import { useEffect } from 'react'
import {
  consentFromCookiebot,
  persistConsent,
  readConsentFromBrowser,
  type CookiebotGlobal,
} from '@/lib/trackingConsent'

/**
 * Espeja el consentimiento de Cookiebot a la cookie `wthr_consent`.
 *
 * ESTE COMPONENTE ES EL ARREGLO DE LA CAUSA RAÍZ #1. Con
 * `feature.cookiebot` activo, `app/layout.tsx` no monta ni el banner
 * propio ni su delegador sin JS — que eran los dos únicos escritores de
 * `wthr_consent`. Cookiebot gestionaba el diálogo y guardaba su propia
 * decisión TCF, pero nada la traducía a la cookie que lee `proxy.ts`.
 * Con la cookie siempre ausente, `isTrackingAllowed` devolvía false para
 * todo el mundo y no se generaba ni una sola identidad ni un solo
 * pageview. Durante meses.
 *
 * No renderiza nada: sólo escucha y escribe.
 */
export default function ConsentSync({ cookiebotEnabled }: { cookiebotEnabled: boolean }) {
  useEffect(() => {
    // Con Cookiebot apagado manda ConsentBanner: no tocamos nada, o
    // tendríamos otra vez dos escritores compitiendo por la misma cookie.
    if (!cookiebotEnabled) return

    const sync = (): void => {
      const cb = (window as unknown as { Cookiebot?: CookiebotGlobal }).Cookiebot
      const value = consentFromCookiebot(cb?.consent)
      // null = Cookiebot aún no ha resuelto. No escribimos: "todavía no
      // sé" no es lo mismo que "ha dicho que no".
      if (!value) return
      // Evita reescribir en cada evento si no ha cambiado nada.
      if (readConsentFromBrowser() === value) return
      persistConsent(value)
    }

    // Lectura ANSIOSA antes de suscribirse. Es imprescindible: el script
    // de Cookiebot es SÍNCRONO en <head> (app/layout.tsx), así que para
    // un visitante recurrente —que ya tiene su decisión guardada—
    // `CookiebotOnConsentReady` ya ha disparado mucho antes de que React
    // hidrate. Suscribirse a secas dejaría sin trackear justo al
    // visitante que más veces vuelve.
    sync()

    const eventos = ['CookiebotOnAccept', 'CookiebotOnDecline', 'CookiebotOnConsentReady'] as const
    for (const ev of eventos) window.addEventListener(ev, sync)
    return () => {
      for (const ev of eventos) window.removeEventListener(ev, sync)
    }
  }, [cookiebotEnabled])

  // Si Cookiebot está activado pero un bloqueador impide que cargue,
  // `window.Cookiebot` no aparece nunca, no se escribe cookie y el
  // tracking queda apagado. Es el comportamiento conservador correcto:
  // sin diálogo de consentimiento no hay consentimiento.
  return null
}
