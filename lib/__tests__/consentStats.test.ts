import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  CONSENT_STATS_PATH,
  registrarEventoConsentimiento,
  resetConsentStats,
} from '@/lib/consentStats'

/**
 * Emisor de la tasa de aceptación.
 *
 * Dos garantías, y las dos son de fondo:
 *
 *  1. NO manda cookies, y por eso NO usa `navigator.sendBeacon` pese a
 *     ser lo que usa el resto del proyecto: el beacon manda siempre las
 *     cookies del origen y no hay forma de desactivarlo. Al pulsar
 *     "Aceptar" ya existe `wthr_consent`, y poco después `wthr_anon`, así
 *     que con beacon esta ruta acabaría recibiendo el identificador del
 *     dispositivo. La garantía tiene que estar en lo que se ENVÍA.
 *  2. Una emisión por tipo y carga de página. Sin eso, cada montaje extra
 *     del banner (StrictMode monta dos veces en desarrollo) sería una
 *     impresión falsa que HUNDE la tasa sin que nadie lo note.
 */

describe('registrarEventoConsentimiento', () => {
  let beaconMock: ReturnType<typeof vi.fn>
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    resetConsentStats()
    beaconMock = vi.fn(() => true)
    fetchMock = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal('navigator', { sendBeacon: beaconMock })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('manda el evento a la ruta anónima SIN credenciales', async () => {
    registrarEventoConsentimiento('shown')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(CONSENT_STATS_PATH)
    expect(init.method).toBe('POST')
    expect(init.credentials, 'esta ruta no debe recibir cookies jamás').toBe('omit')
    expect(JSON.parse(String(init.body))).toEqual({ e: 'shown' })
  })

  it('NUNCA usa sendBeacon, que mandaría las cookies sin poder evitarlo', async () => {
    registrarEventoConsentimiento('accept')

    expect(beaconMock, 'el beacon es credencializado por definición').not.toHaveBeenCalled()
  })

  it('una sola emisión por tipo y carga de página', async () => {
    registrarEventoConsentimiento('shown')
    registrarEventoConsentimiento('shown')
    registrarEventoConsentimiento('shown')

    expect(fetchMock, 'un montaje extra no puede ser una impresión más').toHaveBeenCalledTimes(1)
  })

  it('los distintos tipos no se estorban entre sí', async () => {
    registrarEventoConsentimiento('shown')
    registrarEventoConsentimiento('accept')

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('un fallo de red no propaga: la métrica nunca bloquea el banner', async () => {
    fetchMock.mockImplementation(() => {
      throw new Error('sin red')
    })

    expect(() => registrarEventoConsentimiento('accept')).not.toThrow()
  })
})
