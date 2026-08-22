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
 */

export const CONSENT_COOKIE = 'wthr_consent'

export function isTrackingAllowed(consentCookieValue: string | undefined | null): boolean {
  return consentCookieValue === 'granted'
}

/** Serialize the consent cookie exactly the same way from both writers
 *  (banner document.cookie + any server-side sync). */
export function consentCookieOptions(): { maxAge: number; path: string; sameSite: 'lax' } {
  return { maxAge: 60 * 60 * 24 * 365, path: '/', sameSite: 'lax' }
}
