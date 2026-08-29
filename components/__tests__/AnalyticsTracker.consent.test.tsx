import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup, waitFor } from '@testing-library/react'
import AnalyticsTracker from '@/components/AnalyticsTracker'
import { persistConsent, CONSENT_STORAGE_KEY } from '@/lib/trackingConsent'

/**
 * Aceptar el consentimiento tiene que CONTAR la visita.
 *
 * ESTE FICHERO EXISTE POR UNA PÉRDIDA REAL DE DATOS. El tracker
 * comprobaba el permiso en cada emisión —y su comentario presumía de que
 * así alguien podía aceptar «sin recargar»— pero nada disparaba una
 * emisión al aceptar: sólo emitía al montar, al cambiar la URL y al
 * volver del bfcache. La secuencia de un visitante nuevo era:
 *
 *   montar (sin permiso, no emite) → aceptar (nadie escucha) → se va
 *
 * En una app que se usa en una sola carga de página eso es casi todo el
 * mundo. Sólo quedaban registrados los que aceptaban Y ADEMÁS volvían a
 * cargar el documento: el panel mostraba 4 dispositivos con muchísimas
 * más visitas reales.
 */

const enviados: unknown[] = []
vi.mock('@/lib/analytics/tracker', async () => {
  const real = await vi.importActual<typeof import('@/lib/analytics/tracker')>(
    '@/lib/analytics/tracker',
  )
  return {
    ...real,
    sendIngest: (p: unknown) => { enviados.push(p) },
  }
})

function limpiarConsentimiento() {
  try { localStorage.removeItem(CONSENT_STORAGE_KEY) } catch { /* ignore */ }
  document.cookie = 'wthr_consent=;max-age=0;path=/'
}

describe('AnalyticsTracker · transición a consentimiento otorgado', () => {
  beforeEach(() => {
    enviados.length = 0
    limpiarConsentimiento()
  })

  afterEach(() => {
    cleanup()
    limpiarConsentimiento()
  })

  it('sin permiso no emite nada al montar', () => {
    render(<AnalyticsTracker />)
    expect(enviados).toHaveLength(0)
  })

  it('al aceptar emite la visita SIN necesidad de recargar', async () => {
    render(<AnalyticsTracker />)
    expect(enviados).toHaveLength(0)

    persistConsent('granted')

    await waitFor(() => expect(enviados).toHaveLength(1))
    expect(enviados[0]).toMatchObject({ k: 'pv', src: 'client' })
  })

  it('rechazar no emite: el evento avisa del cambio, no lo autoriza', async () => {
    render(<AnalyticsTracker />)

    persistConsent('rejected')

    // Se espera un poco para que un fallo se manifieste como emisión
    // tardía en vez de pasar por verde sin más.
    await new Promise(r => setTimeout(r, 50))
    expect(enviados).toHaveLength(0)
  })

  it('aceptar dos veces no duplica la visita', async () => {
    render(<AnalyticsTracker />)

    persistConsent('granted')
    await waitFor(() => expect(enviados).toHaveLength(1))

    // Reafirmar la elección (p. ej. desde el centro de preferencias) no
    // debe inflar el recuento: el dedupe por clave rastreada lo corta.
    persistConsent('granted')
    await new Promise(r => setTimeout(r, 50))
    expect(enviados).toHaveLength(1)
  })

  it('quien ya tenía permiso al llegar sigue emitiendo en el montaje', async () => {
    persistConsent('granted')
    enviados.length = 0

    render(<AnalyticsTracker />)

    await waitFor(() => expect(enviados).toHaveLength(1))
  })
})
