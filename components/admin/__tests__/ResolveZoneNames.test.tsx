import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup, waitFor } from '@testing-library/react'
import ResolveZoneNames from '@/components/admin/ResolveZoneNames'

const { refreshMock } = vi.hoisted(() => ({ refreshMock: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: refreshMock }) }))

/**
 * El disparador del nombrado de zonas.
 *
 * Su riesgo propio es el BUCLE: pide nombres, refresca, la página vuelve
 * a pintar las mismas celdas sin nombre (porque el proveedor no las
 * resolvió) y vuelve a pedir. Eso es una tormenta de peticiones a un
 * tercero desde el panel.
 */

function responder(cuerpo: unknown) {
  return new Response(JSON.stringify(cuerpo), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('ResolveZoneNames', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    fetchMock = vi.fn(async () => responder({ ok: true, resueltas: { '41.61,2.65': 'Calella' } }))
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('pide los nombres de las celdas y refresca al conseguirlos', async () => {
    render(<ResolveZoneNames cells={['41.61,2.65']} />)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('/api/admin/zones/resolve')
    expect((init as RequestInit).method).toBe('POST')
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ cells: ['41.61,2.65'] })

    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1))
  })

  it('sin celdas no llama a nada', async () => {
    render(<ResolveZoneNames cells={[]} />)

    await new Promise(r => setTimeout(r, 40))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(refreshMock).not.toHaveBeenCalled()
  })

  it('si no se resuelve ninguna NO refresca: refrescar sin cambios es el bucle', async () => {
    fetchMock.mockResolvedValue(responder({ ok: true, resueltas: {} }))

    render(<ResolveZoneNames cells={['41.61,2.65']} />)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    await new Promise(r => setTimeout(r, 40))
    expect(refreshMock).not.toHaveBeenCalled()
  })

  it('un fallo de red no rompe el panel ni refresca', async () => {
    fetchMock.mockRejectedValue(new Error('sin red'))

    render(<ResolveZoneNames cells={['41.61,2.65']} />)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    await new Promise(r => setTimeout(r, 40))
    expect(refreshMock).not.toHaveBeenCalled()
  })

  it('no repite la petición aunque el efecto se vuelva a ejecutar', async () => {
    // StrictMode en desarrollo monta dos veces; sin el guard serían dos
    // llamadas al proveedor por cada apertura del panel.
    const { rerender } = render(<ResolveZoneNames cells={['41.61,2.65']} />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    rerender(<ResolveZoneNames cells={['41.61,2.65']} />)
    await new Promise(r => setTimeout(r, 40))

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
