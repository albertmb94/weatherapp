/**
 * B-NBT-10 unit tests for the new pure helpers shipped with the admin
 * metrics + monetization work:
 *   - isTrackingAllowed: consent gate contract (missing = OFF).
 *   - safeDecode / validateLatLon: server guard rails.
 */
import { describe, it, expect } from 'vitest'
import { isTrackingAllowed, normalizeConsentValue, consentFromCookiebot, CONSENT_COOKIE } from '@/lib/trackingConsent'
import { safeDecode, validateLatLon } from '@/lib/api/params'

describe('isTrackingAllowed (B-NBT-10)', () => {
  it('allows only an explicit granted', () => {
    expect(isTrackingAllowed('granted')).toBe(true)
  })

  it('blocks rejected, missing and unknown values', () => {
    expect(isTrackingAllowed('rejected')).toBe(false)
    expect(isTrackingAllowed(undefined)).toBe(false)
    expect(isTrackingAllowed(null)).toBe(false)
    expect(isTrackingAllowed('')).toBe(false)
    expect(isTrackingAllowed('GRANTED')).toBe(false)
  })

  it('normalizes legacy banner values (accept/reject bug fix)', () => {
    // The ConsentBanner overwrote 'granted' with 'accept' between
    // 2026-08-22 and the fix; those visitors accepted and must count.
    expect(normalizeConsentValue('granted')).toBe('granted')
    expect(normalizeConsentValue('accept')).toBe('granted')
    expect(normalizeConsentValue('rejected')).toBe('rejected')
    expect(normalizeConsentValue('reject')).toBe('rejected')
    expect(normalizeConsentValue(undefined)).toBeNull()
    expect(normalizeConsentValue('garbage')).toBeNull()
    expect(isTrackingAllowed('accept')).toBe(true)
    expect(isTrackingAllowed('reject')).toBe(false)
  })

  it('exposes the cookie name used by banner + proxy', () => {
    expect(CONSENT_COOKIE).toBe('wthr_consent')
  })
})

describe('safeDecode', () => {
  it('decodes valid segments', () => {
    expect(safeDecode('%40mail.com')).toBe('@mail.com')
    expect(safeDecode('plain')).toBe('plain')
  })

  it('returns null on malformed escapes instead of throwing URIError', () => {
    expect(safeDecode('%zz')).toBeNull()
    expect(safeDecode('%e0%80')).toBeNull()
  })
})

describe('validateLatLon', () => {
  it('accepts a valid pair', () => {
    expect(validateLatLon('41.45', '2.25')).toBeNull()
    expect(validateLatLon('-90', '180')).toBeNull()
  })

  it('rejects out-of-range and junk values', () => {
    expect(validateLatLon('91', '0')).toBe('Invalid latitude')
    expect(validateLatLon('0', '-181')).toBe('Invalid longitude')
    expect(validateLatLon('abc', '0')).toBe('Invalid latitude')
  })

  it('rejects missing params (Number(null) === 0 trap)', () => {
    expect(validateLatLon(null, null)).toBe('Missing coordinates')
    expect(validateLatLon('', null)).toBe('Missing coordinates')
  })
})

describe('consentFromCookiebot (auditoría causa raíz #1)', () => {
  it('mapea la categoría statistics a nuestro vocabulario canónico', () => {
    expect(consentFromCookiebot({ statistics: true })).toBe('granted')
    expect(consentFromCookiebot({ statistics: false })).toBe('rejected')
  })

  it('devuelve null mientras Cookiebot no haya resuelto, para no confundir "aún no sé" con "no"', () => {
    expect(consentFromCookiebot(undefined)).toBeNull()
    expect(consentFromCookiebot(null)).toBeNull()
    expect(consentFromCookiebot({})).toBeNull()
    expect(consentFromCookiebot({ necessary: true, marketing: true })).toBeNull()
  })

  it('IGNORA marketing: aceptar anuncios no es aceptar analítica', () => {
    expect(consentFromCookiebot({ statistics: false, marketing: true })).toBe('rejected')
    expect(consentFromCookiebot({ statistics: true, marketing: false })).toBe('granted')
  })

  it('un statistics no booleano se trata como "sin resolver", no como true', () => {
    expect(consentFromCookiebot({ statistics: 'yes' } as unknown as { statistics?: boolean })).toBeNull()
  })
})
