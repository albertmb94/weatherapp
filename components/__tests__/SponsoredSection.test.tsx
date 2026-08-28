import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import SponsoredSection from '@/components/SponsoredSection'
import { LocaleProvider } from '@/lib/LocaleContext'

/**
 * Sección patrocinada (enlaces de afiliado de Amazon).
 *
 * ESTE FICHERO EXISTE POR UNA REGRESIÓN REAL. B-NBT-14 eliminó a
 * propósito el gate `feature.affiliates` porque era una segunda
 * superficie de control redundante que despistaba ("he añadido el
 * producto y no sale"). El control son LOS PRODUCTOS.
 *
 * Eso dejó en `FriendlyHome` una variable `affiliatesEnabled` calculada
 * y sin usar. Una auditoría posterior la leyó como un descuido y la
 * cableó al slot… con lo que los anuncios desaparecieron de producción
 * pese a haber productos activos — exactamente el síntoma que B-NBT-14
 * quería evitar.
 *
 * Estas pruebas fijan que la sección depende SOLO de que haya producto.
 */

const PRODUCTO = {
  id: 'p1',
  title: 'Protégete con la mejor crema',
  description: 'Factor 50',
  affiliateUrl: 'https://www.amazon.es/dp/B00Z72U6JQ',
}

function montar(slotKey: 'slot_uv' | null) {
  return render(
    <LocaleProvider locale="es">
      <SponsoredSection slotKey={slotKey} />
    </LocaleProvider>,
  )
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({ ok: true, product: PRODUCTO }),
  })) as unknown as typeof fetch)
  try {
    localStorage.clear()
  } catch { /* ignore */ }
  document.cookie = 'wthr_consent=;max-age=0;path=/'
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('SponsoredSection', () => {
  it('muestra el producto cuando hay slot activo', async () => {
    montar('slot_uv')
    await waitFor(() => expect(screen.getByText(PRODUCTO.title)).toBeInTheDocument())
  })

  it('SIN consentimiento TAMBIÉN se muestra', async () => {
    // Mostrar un enlace de texto no almacena ni lee nada en el
    // dispositivo, que es lo que la ePrivacy somete a consentimiento.
    // La atribución del clic sí lo respeta, pero eso ocurre en
    // /api/affiliate/redirect, no aquí. Gatearlo en el render escondía la
    // monetización a todo visitante que no hubiera respondido al banner
    // — es decir, a todos en su primera visita.
    document.cookie = 'wthr_consent=;max-age=0;path=/'
    montar('slot_uv')
    await waitFor(() => expect(screen.getByText(PRODUCTO.title)).toBeInTheDocument())
  })

  it('con consentimiento denegado TAMBIÉN se muestra', async () => {
    document.cookie = 'wthr_consent=rejected;path=/'
    montar('slot_uv')
    await waitFor(() => expect(screen.getByText(PRODUCTO.title)).toBeInTheDocument())
  })

  it('sin slot activo no pide nada ni renderiza', () => {
    montar(null)
    expect(screen.queryByText(PRODUCTO.title)).not.toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('el enlace sale marcado como patrocinado', async () => {
    montar('slot_uv')
    await screen.findByText(PRODUCTO.title)
    // Se localiza por href y no por nombre accesible: el enlace envuelve
    // titulo, descripcion y una flecha, asi que su nombre no es el titulo.
    const enlace = document.querySelector('a[href*="/api/affiliate/redirect"]')
    expect(enlace).not.toBeNull()
    // Google exige rel="sponsored" (o nofollow) en enlaces monetizados.
    expect(enlace!.getAttribute('rel')).toMatch(/sponsored/)
    expect(enlace!.getAttribute('href')).toContain('/api/affiliate/redirect')
  })

  it('si no hay producto para el slot, no renderiza nada', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, product: null }),
    })) as unknown as typeof fetch)
    montar('slot_uv')
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(screen.queryByText(PRODUCTO.title)).not.toBeInTheDocument()
  })
})
