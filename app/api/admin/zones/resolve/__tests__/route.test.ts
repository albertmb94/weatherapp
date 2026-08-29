import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { getCurrentAdminMock, resolveZoneNamesMock } = vi.hoisted(() => ({
  getCurrentAdminMock: vi.fn(),
  resolveZoneNamesMock: vi.fn(),
}))

vi.mock('@/lib/admin/auth', () => ({ getCurrentAdmin: getCurrentAdminMock }))
vi.mock('@/lib/analytics', () => ({ resolveZoneNames: resolveZoneNamesMock }))

import { POST } from '@/app/api/admin/zones/resolve/route'

function pet(cuerpo: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/admin/zones/resolve', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo),
  })
}

describe('/api/admin/zones/resolve', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    resolveZoneNamesMock.mockResolvedValue({})
  })

  it('sin sesión de admin no llama al geocodificador', async () => {
    getCurrentAdminMock.mockResolvedValue(null)

    const res = await POST(pet({ cells: ['41.61,2.65'] }))

    expect(res.status).toBe(401)
    // Lo que se protege: que ninguna ruta pública pueda provocar llamadas
    // a un servicio de terceros.
    expect(resolveZoneNamesMock).not.toHaveBeenCalled()
  })

  it('resuelve las celdas válidas y devuelve los nombres', async () => {
    getCurrentAdminMock.mockResolvedValue('admin@ejemplo.com')
    resolveZoneNamesMock.mockResolvedValue({ '41.61,2.65': 'Calella · Cataluña' })

    const body = await (await POST(pet({ cells: ['41.61,2.65'] }))).json()

    expect(body).toEqual({ ok: true, resueltas: { '41.61,2.65': 'Calella · Cataluña' } })
    expect(resolveZoneNamesMock).toHaveBeenCalledWith(['41.61,2.65'])
  })

  it('descarta lo que no es una celda antes de llamar a nadie', async () => {
    // El panel manda sus etiquetas, y muchas ya son nombres resueltos o
    // "(desconocido)". Filtrarlas después sería una llamada externa
    // desperdiciada por cada una.
    getCurrentAdminMock.mockResolvedValue('admin@ejemplo.com')

    await POST(pet({ cells: ['Badalona · Cataluña', '(desconocido)', '41.61,2.65', '95.00,2.00'] }))

    expect(resolveZoneNamesMock).toHaveBeenCalledWith(['41.61,2.65'])
  })

  it('sin ninguna celda válida no llama al geocodificador', async () => {
    getCurrentAdminMock.mockResolvedValue('admin@ejemplo.com')

    const body = await (await POST(pet({ cells: ['Badalona · Cataluña'] }))).json()

    expect(body).toEqual({ ok: true, resueltas: {} })
    expect(resolveZoneNamesMock).not.toHaveBeenCalled()
  })

  it('acota a 12 celdas por petición', async () => {
    // Sin tope, abrir el panel con muchas zonas nuevas dispararía una
    // ráfaga de llamadas a un tercero.
    getCurrentAdminMock.mockResolvedValue('admin@ejemplo.com')
    const muchas = Array.from({ length: 30 }, (_, i) => `41.${String(i).padStart(2, '0')},2.65`)

    await POST(pet({ cells: muchas }))

    expect((resolveZoneNamesMock.mock.calls[0][0] as string[]).length).toBe(12)
  })

  it('rechaza un cuerpo que no es JSON o sin `cells`', async () => {
    getCurrentAdminMock.mockResolvedValue('admin@ejemplo.com')

    expect((await POST(pet('no-es-json'))).status).toBe(400)
    expect((await POST(pet({}))).status).toBe(400)
    expect(resolveZoneNamesMock).not.toHaveBeenCalled()
  })

  it('un fallo del geocodificador devuelve 500, no un ok vacío', async () => {
    getCurrentAdminMock.mockResolvedValue('admin@ejemplo.com')
    resolveZoneNamesMock.mockRejectedValue(new Error('proveedor caído'))

    const res = await POST(pet({ cells: ['41.61,2.65'] }))

    expect(res.status).toBe(500)
    expect((await res.json()).ok).toBe(false)
  })
})
