'use client'

import { useEffect, useSyncExternalStore, useState } from 'react'
import { normalizeConsentValue, persistConsent, writeConsentCookie } from '@/lib/trackingConsent'
import { registrarEventoConsentimiento } from '@/lib/consentStats'
import { usePathname } from 'next/navigation'
import { DEFAULT_LOCALE, localizedHref, splitLocale } from '@/lib/locale/routing'
import { STRINGS } from '@/lib/i18n'

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
/**
 * Elección guardada, leyendo PRIMERO la cookie.
 *
 * El orden importa y antes estaba al revés. localStorage decidía si se
 * pinta el banner, pero la COOKIE es lo que el servidor mira para
 * decidir si te cuenta. Cuando divergen —la cookie caduca antes (1 año
 * frente a los 2 del identificador), la borra una limpieza del navegador
 * o la bloquea una configuración estricta— pasaba lo peor de los dos
 * mundos: el banner NO salía (el cliente creía que ya habías
 * respondido) y el servidor NO te contaba. Silencioso y permanente.
 *
 * Se detectó justo así: el autodiagnóstico decía "consentimiento sin
 * responder" e "identidad anónima: sí" a la vez, que es imposible salvo
 * en este caso, y el banner no aparecía por ninguna parte.
 *
 * Ahora, si sólo queda el rastro en localStorage, se REESCRIBE la cookie
 * en vez de ocultar el banner: la persona ya eligió, lo que se perdió
 * fue el espejo. Eso honra su decisión sin volver a preguntársela.
 */
function readStoredChoice(): 'accept' | 'reject' | null {
  // AUDITORÍA: aquí había `if (window.Cookiebot) return 'accept'`, que
  // daba por ACEPTADO el consentimiento por el mero hecho de que
  // Cookiebot estuviera cargado, sin mirar qué había elegido la persona.
  // Sólo servía para ocultar este banner, pero afirmaba algo falso. Hoy
  // el caso Cookiebot lo gestiona <ConsentSync>, y este componente ni
  // siquiera se monta en esa configuración.
  // La cookie primero: es la que gobierna de verdad el seguimiento.
  let cookie: 'granted' | 'rejected' | null = null
  try {
    const m = document.cookie.match(/(?:^|;\s*)wthr_consent=([^;]*)/)
    cookie = normalizeConsentValue(m?.[1])
  } catch { /* ignore */ }
  if (cookie) return cookie === 'granted' ? 'accept' : 'reject'

  // Sin cookie pero con rastro en localStorage: se restaura el espejo.
  // `writeConsentCookie` emite además el aviso de cambio, así que el
  // tracker empieza a contar en el acto si la elección era aceptar.
  let guardado: 'granted' | 'rejected' | null = null
  try {
    guardado = normalizeConsentValue(localStorage.getItem('wthr_consent'))
  } catch { /* storage bloqueado */ }
  if (guardado) {
    writeConsentCookie(guardado)
    return guardado === 'granted' ? 'accept' : 'reject'
  }

  return null
}

/**
 * Rutas que se pueden leer SIN haber aceptado.
 *
 * Sin esto, el enlace a la política de cookies del propio diálogo llevaba
 * a una página tapada por el mismo diálogo.
 */
const RUTAS_EXENTAS = ['/cookies', '/privacy', '/terms', '/affiliate-disclosure']

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
  const t = STRINGS[locale]

  // `show` se deriva durante render (solo se lee storage en cliente).
  // PÁGINAS LEGALES EXENTAS, y no es una concesión: el propio diálogo
  // enlaza la política de cookies, y con el modal tapando todo no se
  // podría leer antes de decidir. Un consentimiento que no se puede
  // informar no vale, así que estas rutas se ven sin responder.
  const { rest } = splitLocale(pathname ?? '/')
  const esPaginaLegal = RUTAS_EXENTAS.some(r => rest === r || rest.startsWith(r + '/'))

  // SÓLO 'accept' CIERRA. Decisión de producto: el acceso a los datos
  // exige aceptar. Ojo a la diferencia con la versión anterior: no basta
  // con haber RESPONDIDO, hace falta haber ACEPTADO. Si bastara con
  // responder, rechazar una vez sería una puerta trasera —seguirías
  // navegando sin aceptar y sin volver a ver el diálogo— y el muro no
  // sería tal. Quien retire el consentimiento desde /cookies vuelve a
  // encontrárselo, que es la consecuencia coherente.
  const show =
    isMounted && !esPaginaLegal && !submitted && readStoredChoice() !== 'accept' && !answeredInSession

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
    // DIÁLOGO CENTRADO Y BLOQUEANTE, por decisión de producto: el acceso
    // a los datos queda detrás de responder al consentimiento.
    //
    // Antes era una tarjeta abajo a un lado que se podía ignorar
    // indefinidamente. Eso dejaba a mucha gente navegando sin haber
    // respondido —ni aceptado ni rechazado—, que en la práctica es lo
    // mismo que rechazar pero sin que nadie lo decida.
    //
    // El fondo tapa e intercepta: mientras no haya respuesta no se puede
    // interactuar con la página. Cuidado con esto en móvil — la versión
    // anterior estaba anclada abajo y llegó a solaparse con la barra de
    // pestañas, interceptando sus pulsaciones; centrado y con la página
    // bloqueada a propósito, ese conflicto ya no aplica.
    <div
      className="fixed inset-0 z-[3000] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      // No se cierra al pulsar fuera: eso sería otra forma de ignorarlo.
      aria-hidden={false}
    >
    <div
      data-consent-dialog=""
      role="dialog"
      aria-modal="true"
      aria-label={t.consentDialogLabel}
      className="w-full max-w-sm rounded-2xl border border-border bg-surface-raised p-4 shadow-2xl"
    >
      {/* EN EL IDIOMA DE QUIEN LEE. Este texto estaba en español a
          pelo, y desde que el diálogo pasó a bloquear la página era lo
          primero y lo único que veía un visitante anglófono: un modal
          impenetrable en un idioma que no entiende, con un solo botón.
          O aceptaba a ciegas —y un consentimiento que no se comprende
          no es consentimiento— o se iba. */}
      <p className="text-sm font-medium text-text-primary">{t.consentTitle}</p>
      <p className="text-xs text-text-secondary mt-1.5">
        {t.consentBody}
        <a href={localizedHref('/cookies', locale)} className="text-accent hover:underline">
          {t.consentPolicyLink}
        </a>
        .
      </p>
      {/* UN SOLO BOTÓN. Mientras "Rechazar" no cerrara el diálogo, tenerlo
          ahí sería peor que no tenerlo: una salida que no lleva a ninguna
          parte. Quien no quiera aceptar puede cerrar la pestaña, y quien
          acepte y se arrepienta puede retirarlo desde la política de
          cookies, enlazada arriba (el RGPD exige que retirar sea tan
          fácil como otorgar). */}
      <div className="mt-3">
        <button
          data-consent-choice="accept"
          onClick={() => persist('accept')}
          className="w-full py-2 rounded bg-accent text-white text-sm font-medium"
        >
          {t.consentAccept}
        </button>
      </div>
    </div>
    </div>
  )
}
