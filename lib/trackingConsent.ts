/**
 * B-NBT-10 (2026-08-22): consent gating for anonymous analytics.
 *
 * The visitor's cookie choice lives in TWO places by necessity:
 *   - localStorage (`wthr_consent`) — read by the client banner.
 *   - A plain (JS-writable) cookie `wthr_consent` with the same value —
 *     because the Edge proxy CANNOT read localStorage, and the whole
 *     point of B-NBT-10 is that the proxy stops generating identity
 *     cookies / firing pageviews when the visitor declined.
 *
 * Contract enforced everywhere via `isTrackingAllowed`:
 *   - 'granted'  → analytics on
 *   - 'rejected' | missing | anything else → analytics OFF.
 * Missing counts as OFF: the very first request of a brand-new visitor
 * is not tracked; once they accept, subsequent requests are.
 *
 * AUDITORÍA (causa raíz #1): ese contrato es correcto, pero con
 * `feature.cookiebot` ACTIVO no había NADIE que escribiera el valor.
 * `app/layout.tsx` monta el banner propio y su delegador sin JS sólo
 * cuando Cookiebot está apagado, y el consentimiento TCF de Cookiebot
 * nunca se espejaba a `wthr_consent`. Resultado: `isTrackingAllowed`
 * devolvía false para el 100% de los visitantes, de forma permanente, y
 * el panel de métricas mostraba cero — sin ningún error a la vista.
 * `consentFromCookiebot` + `components/ConsentSync.tsx` cierran ese
 * hueco.
 */

export const CONSENT_COOKIE = 'wthr_consent'
export const CONSENT_STORAGE_KEY = 'wthr_consent'
export const CONSENT_STORAGE_TS_KEY = 'wthr_consent_ts'

export type ConsentValue = 'granted' | 'rejected'

/**
 * Canonical value is 'granted' | 'rejected' (what layout.tsx's inline
 * delegator writes). Between 2026-08-22 and the ConsentBanner fix the
 * React handler ALSO ran on the same click and overwrote the cookie
 * with 'accept'/'reject', which the gate below rejected — so accepted
 * visitors were never tracked and the metrics chart flatlined at 0.
 * Normalize those legacy values here: cookies live 365 days, so real
 * visitors are still carrying 'accept' today and would stay invisible
 * for a year without this mapping.
 */
export function normalizeConsentValue(value: string | undefined | null): ConsentValue | null {
  if (value === 'granted' || value === 'accept') return 'granted'
  if (value === 'rejected' || value === 'reject') return 'rejected'
  return null
}

export function isTrackingAllowed(consentCookieValue: string | undefined | null): boolean {
  return normalizeConsentValue(consentCookieValue) === 'granted'
}

/** Serialize the consent cookie exactly the same way from both writers
 *  (banner document.cookie + any server-side sync). */
export function consentCookieOptions(): { maxAge: number; path: string; sameSite: 'lax' } {
  return { maxAge: 60 * 60 * 24 * 365, path: '/', sameSite: 'lax' }
}

// ---------------------------------------------------------------------------
// Cookiebot (TCF)
// ---------------------------------------------------------------------------

/** Forma del objeto que expone Cookiebot en `window.Cookiebot.consent`. */
export interface CookiebotConsent {
  necessary?: boolean
  preferences?: boolean
  statistics?: boolean
  marketing?: boolean
}

export interface CookiebotGlobal {
  consent?: CookiebotConsent
  hasResponse?: boolean
}

/**
 * Traduce el consentimiento de Cookiebot a nuestro vocabulario.
 *
 * Se consulta SÓLO la categoría `statistics`, que es la que cubre la
 * medición de audiencia anónima. `marketing` gobierna anuncios y
 * afiliados y no debe abrir la analítica: son decisiones separadas y
 * mezclarlas es justo el tipo de atajo que convierte un banner de
 * cookies en un problema legal.
 *
 * Devuelve `null` cuando Cookiebot todavía no ha resuelto nada, para
 * poder distinguir "aún no sé" de "ha dicho que no" — el primero no debe
 * escribir cookie ninguna.
 */
export function consentFromCookiebot(c: CookiebotConsent | undefined | null): ConsentValue | null {
  if (!c || typeof c.statistics !== 'boolean') return null
  return c.statistics ? 'granted' : 'rejected'
}

// ---------------------------------------------------------------------------
// Escritura en el navegador (único serializador compartido)
// ---------------------------------------------------------------------------

/**
 * Espeja la elección a la cookie que lee el proxy Edge.
 *
 * DEBE escribir los valores canónicos 'granted'/'rejected' — el mismo
 * vocabulario que el delegador inline de layout.tsx. Cuando hubo dos
 * escritores con vocabularios distintos, el segundo pisaba un 'granted'
 * válido con un valor que el gate no sabía leer, y el tracking se
 * apagaba para todo el que aceptaba. Por eso existe esta única función.
 */
export function writeConsentCookie(value: ConsentValue): void {
  try {
    const opts = consentCookieOptions()
    document.cookie = `${CONSENT_COOKIE}=${value};max-age=${opts.maxAge};path=${opts.path};samesite=${opts.sameSite}`
  } catch {
    /* ignore */
  }
}

/** Persiste la elección en localStorage Y en la cookie espejo. */
export function persistConsent(value: ConsentValue): void {
  try {
    localStorage.setItem(CONSENT_STORAGE_KEY, value)
    localStorage.setItem(CONSENT_STORAGE_TS_KEY, String(Date.now()))
  } catch {
    /* storage bloqueado — la cookie sigue aplicando */
  }
  writeConsentCookie(value)
}

/** Lee la elección actual del navegador (localStorage y, si está
 *  bloqueado o particionado, la cookie espejo). */
export function readConsentFromBrowser(): ConsentValue | null {
  try {
    const v = normalizeConsentValue(localStorage.getItem(CONSENT_STORAGE_KEY))
    if (v) return v
  } catch {
    /* storage bloqueado */
  }
  try {
    const m = document.cookie.match(/(?:^|;\s*)wthr_consent=([^;]*)/)
    const v = normalizeConsentValue(m?.[1])
    if (v) return v
  } catch {
    /* ignore */
  }
  return null
}
