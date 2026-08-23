'use client'

import { useEffect, useState } from 'react'
import { CONSENT_COOKIE, consentCookieOptions } from '@/lib/trackingConsent'

/** Lightweight consent banner that activates when feature.cookiebot is
 *  disabled and the admin needs a stop-gap. When Cookiebot is enabled
 *  (via /admin/features) it takes over the consent UX; this banner is
 *  suppressed in that case to avoid double-prompts.
 *
 *  B-NBT-10: the choice is ALSO mirrored to the `wthr_consent` cookie
 *  so the Edge proxy can honour it server-side â€” localStorage is
 *  invisible to middleware, and until this mirror existed the proxy
 *  tracked every visitor pre-consent.
 *
 *  B-NBT-10 FIX (bug report): the previous version rendered the dialog
 *  DURING SSR/prerender. The server can never know the consent state,
 *  so the static HTML always contained a VISIBLE dialog. On routes
 *  served from the prerender shell that copy ended up ORPHANED outside
 *  the hydrated tree (no React fibers, direct child of <body>) and
 *  completely inert â€” the user saw a banner they had already dismissed
 *  and could not close. Fix: classic mounted-gate â€” the banner can only
 *  exist after the component mounts on the client, never in server
 *  HTML. */
function readStoredChoice(): 'accept' | 'reject' | null {
  // Cookiebot takes over the consent UX when present.
  if ((window as unknown as { Cookiebot?: unknown }).Cookiebot) return 'accept'
  try {
    const ls = localStorage.getItem('wthr_consent')
    if (ls === 'accept' || ls === 'reject') return ls
  } catch { /* storage blocked */ }
  // Fallback: the cookie mirror survives even when localStorage is
  // partitioned/blocked (Safari private mode, strict browser settings).
  const m = document.cookie.match(/(?:^|;\s*)wthr_consent=(granted|rejected)/)
  if (m) return m[1] === 'granted' ? 'accept' : 'reject'
  return null
}

/** Mirror the choice into a cookie readable by proxy.ts. */
function writeConsentCookie(value: 'accept' | 'reject'): void {
  try {
    const opts = consentCookieOptions()
    document.cookie = `${CONSENT_COOKIE}=${value};max-age=${opts.maxAge};path=${opts.path};samesite=${opts.sameSite}`
  } catch { /* ignore */ }
}

/** Session-lifetime guard: once answered IN THIS DOCUMENT the banner
 *  must never remount, even if localStorage is blocked (quota/private
 *  mode) â€” previously that made the banner immortal within the SPA. */
let answeredInSession = false

export default function ConsentBanner() {
  const [mounted, setMounted] = useState(false)
  const [show, setShow] = useState(false)

  useEffect(() => {
    setMounted(true)
    setShow(readStoredChoice() === null && !answeredInSession)
  }, [])

  function persist(value: 'accept' | 'reject') {
    answeredInSession = true
    try {
      localStorage.setItem('wthr_consent', value)
      localStorage.setItem('wthr_consent_ts', String(Date.now()))
    } catch { /* storage blocked â€” cookie + session guard still apply */ }
    writeConsentCookie(value)
    setShow(false)
  }

  if (!mounted || !show) return null

  return (
    <div
      data-consent-dialog=""
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
          data-consent-choice="accept"
          onClick={() => persist('accept')}
          className="flex-1 py-1.5 rounded bg-accent text-white text-xs font-medium"
        >
          Aceptar
        </button>
        <button
          data-consent-choice="reject"
          onClick={() => persist('reject')}
          className="flex-1 py-1.5 rounded border border-border text-xs text-text-secondary"
        >
          Rechazar
        </button>
      </div>
    </div>
  )
}
