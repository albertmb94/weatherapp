import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import ConsentSync from '@/components/ConsentSync'
import { readConsentFromBrowser, type CookiebotGlobal } from '@/lib/trackingConsent'

/**
 * Test de regresión del apagón de analytics.
 *
 * Con `feature.cookiebot` activo, NADIE escribía `wthr_consent`, así que
 * `proxy.ts` bloqueaba el 100% del tracking de forma permanente. Estas
 * pruebas fijan el contrato del espejo.
 */

function setCookiebot(consent: CookiebotGlobal['consent'] | undefined): void {
  if (consent === undefined) {
    delete (window as unknown as { Cookiebot?: unknown }).Cookiebot
    return
  }
  ;(window as unknown as { Cookiebot?: CookiebotGlobal }).Cookiebot = { consent }
}

function limpiar(): void {
  try {
    localStorage.clear()
  } catch { /* ignore */ }
  document.cookie = 'wthr_consent=;max-age=0;path=/'
  setCookiebot(undefined)
}

beforeEach(limpiar)
afterEach(() => {
  cleanup()
  limpiar()
})

describe('ConsentSync con Cookiebot activo', () => {
  it('ESCRIBE el consentimiento que Cookiebot ya tenía al montar, SIN esperar a ningún evento', () => {
    // Éste es el caso que rompía a los visitantes recurrentes: uc.js es
    // un script síncrono en <head>, así que CookiebotOnConsentReady ya
    // ha disparado antes de que React hidrate. Suscribirse a secas no
    // basta.
    setCookiebot({ statistics: true, marketing: false })
    render(<ConsentSync cookiebotEnabled />)
    expect(readConsentFromBrowser()).toBe('granted')
    expect(document.cookie).toContain('wthr_consent=granted')
  })

  it('escribe "rejected" cuando statistics es false', () => {
    setCookiebot({ statistics: false, marketing: true })
    render(<ConsentSync cookiebotEnabled />)
    expect(readConsentFromBrowser()).toBe('rejected')
  })

  it('NO consulta la categoría marketing: los anuncios no abren la analítica', () => {
    setCookiebot({ statistics: false, marketing: true })
    render(<ConsentSync cookiebotEnabled />)
    expect(readConsentFromBrowser()).toBe('rejected')
  })

  it('no escribe nada mientras Cookiebot no haya resuelto (statistics ausente)', () => {
    // "Todavía no sé" no es lo mismo que "ha dicho que no".
    setCookiebot({ necessary: true })
    render(<ConsentSync cookiebotEnabled />)
    expect(readConsentFromBrowser()).toBeNull()
  })

  it('no escribe nada si Cookiebot está bloqueado y nunca aparece', () => {
    setCookiebot(undefined)
    render(<ConsentSync cookiebotEnabled />)
    expect(readConsentFromBrowser()).toBeNull()
  })

  it('reacciona a CookiebotOnAccept posterior al montaje', () => {
    setCookiebot({ necessary: true })
    render(<ConsentSync cookiebotEnabled />)
    expect(readConsentFromBrowser()).toBeNull()

    setCookiebot({ statistics: true })
    act(() => {
      window.dispatchEvent(new Event('CookiebotOnAccept'))
    })
    expect(readConsentFromBrowser()).toBe('granted')
  })

  it('reacciona a CookiebotOnDecline y revierte un consentimiento previo', () => {
    setCookiebot({ statistics: true })
    render(<ConsentSync cookiebotEnabled />)
    expect(readConsentFromBrowser()).toBe('granted')

    setCookiebot({ statistics: false })
    act(() => {
      window.dispatchEvent(new Event('CookiebotOnDecline'))
    })
    expect(readConsentFromBrowser()).toBe('rejected')
  })

  it('deja de escuchar al desmontar', () => {
    setCookiebot({ statistics: false })
    const { unmount } = render(<ConsentSync cookiebotEnabled />)
    expect(readConsentFromBrowser()).toBe('rejected')
    unmount()

    setCookiebot({ statistics: true })
    act(() => {
      window.dispatchEvent(new Event('CookiebotOnAccept'))
    })
    // Sigue en 'rejected': el listener se retiró.
    expect(readConsentFromBrowser()).toBe('rejected')
  })
})

describe('ConsentSync con Cookiebot desactivado', () => {
  it('no toca nada: manda ConsentBanner', () => {
    // Dos escritores compitiendo por la misma cookie es exactamente el
    // bug que ya se pagó una vez (valores 'accept' pisando 'granted').
    setCookiebot({ statistics: true })
    render(<ConsentSync cookiebotEnabled={false} />)
    expect(readConsentFromBrowser()).toBeNull()
  })

  it('tampoco reacciona a los eventos de Cookiebot', () => {
    setCookiebot({ statistics: true })
    render(<ConsentSync cookiebotEnabled={false} />)
    act(() => {
      window.dispatchEvent(new Event('CookiebotOnAccept'))
    })
    expect(readConsentFromBrowser()).toBeNull()
  })
})
