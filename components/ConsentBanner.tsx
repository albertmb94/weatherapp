'use client'

import { useEffect, useSyncExternalStore, useState } from 'react'
import { normalizeConsentValue, persistConsent } from '@/lib/trackingConsent'
import { registrarEventoConsentimiento } from '@/lib/consentStats'
import { usePathname } from 'next/navigation'
import { DEFAULT_LOCALE, localizedHref, splitLocale } from '@/lib/locale/routing'

/** Lightweight consent banner that activates when feature.cookiebot is
 *  disabled and the admin needs a stop-gap. When Cookiebot is enabled
 *  (via /admin/features) it takes over the consent UX; this banner is
 *  suppressed in that case to avoid double-prompts.
 *
 *  B-NBT-10: the choice is ALSO mirrored to the `wthr_consent` cookie
 *  so the Edge proxy can honour it server-side — localStorage is
 *  invisible to middleware, and until this mirror existed the proxy
 *  tracked every visitor pre-consent.
 *
 *  B-NBT-10 FIX (bug report): the previous version rendered the dialog
 *  DURING SSR/prerender. The server can never know the consent state,
 *  so the static HTML always contained a VISIBLE dialog. On routes
 *  served from the prerender shell that copy ended up ORPHANED outside
 *  the hydrated tree (no React fibers, direct child of <body>) and
 *  completely inert — the user saw a banner they had already dismissed
 *  and could not close. Fix: classic mounted-gate — the banner can only
 *  exist after the component mounts on the client, never in server
 *  HTML. */
function readStoredChoice(): 'accept' | 'reject' | null {
  // AUDITORÍA: aquí había `if (window.Cookiebot) return 'accept'`, que
  // daba por ACEPTADO el consentimiento por el mero hecho de que
  // Cookiebot estuviera cargado, sin mirar qué había elegido la persona.
  // Sólo servía para ocultar este banner, pero afirmaba algo falso. Hoy
  // el caso Cookiebot lo gestiona <ConsentSync>, y este componente ni
  // siquiera se monta en esa configuración.
  try {
    const v = normalizeConsentValue(localStorage.getItem('wthr_consent'))
    if (v) return v === 'granted' ? 'accept' : 'reject'
  } catch { /* storage blocked */ }
  // Fallback: the cookie mirror survives even when localStorage is
  // partitioned/blocked (Safari private mode, strict browser settings).
  try {
    const m = document.cookie.match(/(?:^|;\s*)wthr_consent=([^;]*)/)
    const v = normalizeConsentValue(m?.[1])
    if (v) return v === 'granted' ? 'accept' : 'reject'
  } catch { /* ignore */ }
  return null
}

/** Session-lifetime guard: once answered IN THIS DOCUMENT the banner
 *  must never remount, even if localStorage is blocked (quota/private
 *  mode) — previously that made the banner immortal within the SPA. */
let answeredInSession = false

const emptySubscribe = () => () => {}

export default function ConsentBanner() {
  // Guard de montaje sin efectos (auditoría lint): `useSyncExternalStore`
  // devuelve `false` durante SSR/hidratación y `true` tras montar en el
  // cliente — sustituye el clásico `setMounted(true)` en un useEffect.
  const isMounted = useSyncExternalStore(emptySubscribe, () => true, () => false)
  const [submitted, setSubmitted] = useState(false)
  // NO se usa useLocale() a proposito: este banner se monta FUERA de
  // <Providers> (ver app/layout.tsx) precisamente para sobrevivir a un
  // fallo del arbol de proveedores, asi que el contexto puede no
  // existir y el hook lanzaria. El idioma se lee de la ruta, que
  // siempre esta disponible.
  const pathname = usePathname()
  const locale = splitLocale(pathname ?? '/').locale ?? DEFAULT_LOCALE

  // `show` se deriva durante render (solo se lee storage en cliente).
  const show = isMounted && !submitted && readStoredChoice() === null && !answeredInSession

  // Impresión del banner. Se cuenta DESDE AQUÍ y no desde el layout a
  // propósito: así impresión y respuesta se registran —o se pierden—
  // juntas. Si el banner no llega a montarse (hidratación caída, y sólo
  // actúa el delegador inline), no se cuenta ni la una ni la otra, y la
  // tasa sigue siendo coherente en vez de quedarse con respuestas sin
  // denominador.
  useEffect(() => {
    if (show) registrarEventoConsentimiento('shown')
  }, [show])

  function persist(value: 'accept' | 'reject') {
    answeredInSession = true
    // Canonical values so this handler is truly idempotent with the
    // inline delegator in layout.tsx (which fires first, capture phase).
    const canonical = value === 'accept' ? 'granted' : 'rejected'
    // Un único serializador compartido con ConsentSync y con el
    // delegador inline: tres escritores, un solo vocabulario.
    persistConsent(canonical)
    registrarEventoConsentimiento(value === 'accept' ? 'accept' : 'reject')
    setSubmitted(true)
  }

  if (!show) return null

  return (
    <div
      data-consent-dialog=""
      role="dialog"
      aria-label="Consentimiento de cookies"
      // `bottom-20` en móvil: con `bottom-3` el diálogo se solapaba con la
      // barra de pestañas inferior (MobileTabBar, min-h 52px) y, al estar
      // en z-[3000], INTERCEPTABA sus pulsaciones. En un móvil la
      // navegación principal quedaba bloqueada hasta responder al banner,
      // y quien lo ignorase no podía cambiar de pestaña. En pantallas
      // grandes no hay barra inferior, así que vuelve abajo del todo.
      className="fixed bottom-20 sm:bottom-3 left-3 right-3 sm:left-auto sm:right-3 sm:max-w-sm z-[3000] rounded-2xl border border-border bg-surface-raised p-3 shadow-xl"
    >
      <p className="text-xs text-text-secondary">
        Usamos cookies para recordar tus preferencias y, con tu consentimiento, mostrar anuncios y medir uso agregado.
        Consulta la <a href={localizedHref('/cookies', locale)} className="text-accent hover:underline">política de cookies</a>.
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
