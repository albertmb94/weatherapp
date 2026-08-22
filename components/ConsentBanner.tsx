'use client'

import { useState } from 'react'

/** Lightweight consent banner that activates when feature.cookiebot is
 *  disabled and the admin needs a stop-gap. When Cookiebot is enabled
 *  (via /admin/features) it takes over the consent UX; this banner is
 *  suppressed in that case to avoid double-prompts. The banner writes
 *  a single localStorage flag so we don't pester returning visitors.
 *
 *  We read the localStorage value during initial render (browsers
 *  only, since `typeof window` is checked) so the user doesn't see
 *  the banner flash if they've already answered. */
function readConsent(): 'accept' | 'reject' | null {
  if (typeof window === 'undefined') return null
  // Bail out if Cookiebot is loaded
  if ((window as unknown as { Cookiebot?: unknown }).Cookiebot) return 'accept'
  try {
    return localStorage.getItem('wthr_consent') as 'accept' | 'reject' | null
  } catch {
    return null
  }
}

export default function ConsentBanner() {
  const [show, setShow] = useState<boolean>(() => readConsent() === null)

  function persist(value: 'accept' | 'reject') {
    try {
      localStorage.setItem('wthr_consent', value)
      localStorage.setItem('wthr_consent_ts', String(Date.now()))
    } catch { /* ignore */ }
    setShow(false)
  }

  if (!show) return null

  return (
    <div
      role="dialog"
      aria-label="Consentimiento de cookies"
      className="fixed bottom-3 left-3 right-3 sm:left-auto sm:right-3 sm:max-w-sm z-[3000] rounded-2xl border border-border bg-surface-raised p-3 shadow-xl"
    >
      <p className="text-xs text-text-secondary">
        Usamos cookies para recordar tus preferencias y, con tu consentimiento, mostrar anuncios y medir uso agregado.
        Consulta la <a href="/cookies" className="text-accent hover:underline">política de cookies</a>.
      </p>
      <div className="flex gap-2 mt-2">
        <button
          onClick={() => persist('accept')}
          className="flex-1 py-1.5 rounded bg-accent text-white text-xs font-medium"
        >
          Aceptar
        </button>
        <button
          onClick={() => persist('reject')}
          className="flex-1 py-1.5 rounded border border-border text-xs text-text-secondary"
        >
          Rechazar
        </button>
      </div>
    </div>
  )
}
