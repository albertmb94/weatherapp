import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * "Guardado" tiene que significar guardado.
 *
 * `db.execute` es PERMISIVO por contrato: ante un fallo devuelve `false`
 * en vez de lanzar. Eso es correcto para cachés y flags que caen a OFF,
 * pero envenena cualquier ruta que le diga a una persona que su cambio
 * se aplicó. Se encontraron cuatro sitios con la misma forma:
 *
 *   - borrar un producto de afiliado respondía { ok: true } sin borrarlo;
 *   - guardar una feature flag respondía { ok: true } sin guardarla, y
 *     esas flags gobiernan Stripe, AdSense y Cookiebot;
 *   - crear un producto devolvía { ok: true, id } sin crearlo — el
 *     "lo he añadido y no sale" que ya costó una investigación entera;
 *   - el login ponía la cookie aunque no pudiera registrar la sesión,
 *     con un catch que su propio comentario llamaba "fail-closed" y que
 *     NO PODÍA EJECUTARSE. Resultado: bucle de login sin explicación.
 *
 * Estos tests fijan el contrato desde fuera: si la escritura falla, la
 * respuesta NO puede ser un éxito.
 */

const { executeMock, executeOrThrowMock, selectMock, getCurrentAdminMock } = vi.hoisted(() => ({
  executeMock: vi.fn(async () => false),
  executeOrThrowMock: vi.fn(async () => {
    throw new Error('base de datos caída')
  }),
  selectMock: vi.fn(async () => []),
  getCurrentAdminMock: vi.fn(async () => 'admin@ejemplo.com' as string | null),
}))

vi.mock('@/lib/db', async () => {
  const real = await vi.importActual<typeof import('@/lib/db')>('@/lib/db')
  return {
    ...real,
    db: {
      execute: executeMock,
      executeOrThrow: executeOrThrowMock,
      select: selectMock,
      selectOrThrow: selectMock,
      available: true,
      configured: true,
      ensure: async () => true,
    },
  }
})
vi.mock('@/lib/admin/auth', () => ({
  getCurrentAdmin: getCurrentAdminMock,
  setAdminCookie: vi.fn(),
  applyAdminCookieToResponse: vi.fn(),
  generateToken: () => 'token-de-prueba',
  verifyAdminLogin: vi.fn(async () => true),
  ADMIN_SESSION_TTL_MS: 604800000,
}))
vi.mock('@/lib/features', () => ({
  getFeature: vi.fn(async () => ({ enabled: false, config: {} })),
  revalidateFeature: vi.fn(),
  ensureFeatureFlagsSchema: vi.fn(async () => true),
  FEATURE_CATALOG: [],
}))
vi.mock('@/lib/rateLimit', () => ({ rateLimit: () => true }))

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  getCurrentAdminMock.mockResolvedValue('admin@ejemplo.com')
  executeOrThrowMock.mockRejectedValue(new Error('base de datos caída'))
  selectMock.mockResolvedValue([])
})

describe('borrado de producto de afiliado', () => {
  it('un borrado fallido NO responde ok', async () => {
    const { DELETE } = await import('@/app/api/admin/affiliates/[id]/route')

    const res = await DELETE(
      new NextRequest('http://localhost:3000/api/admin/affiliates/p1', { method: 'DELETE' }),
      { params: Promise.resolve({ id: 'p1' }) },
    )
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body.ok).toBe(false)
    // Y no se filtra el mensaje crudo de libsql.
    expect(JSON.stringify(body)).not.toContain('base de datos caída')
  })

  it('usa la variante ESTRICTA: con la permisiva el catch es código muerto', async () => {
    const { DELETE } = await import('@/app/api/admin/affiliates/[id]/route')

    await DELETE(
      new NextRequest('http://localhost:3000/api/admin/affiliates/p1', { method: 'DELETE' }),
      { params: Promise.resolve({ id: 'p1' }) },
    )

    expect(executeOrThrowMock).toHaveBeenCalled()
    expect(executeMock).not.toHaveBeenCalled()
  })
})

describe('alta de producto de afiliado', () => {
  it('si no se puede escribir, NO devuelve ok con un id inventado', async () => {
    const { POST } = await import('@/app/api/admin/affiliates/route')

    const res = await POST(
      new NextRequest('http://localhost:3000/api/admin/affiliates', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          trigger: 'slot_uv',
          locale: 'es',
          title: 'Crema solar',
          amazonUrl: 'https://www.amazon.es/dp/B0BLD7QKDC',
        }),
      }),
    )
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body.ok).toBe(false)
    expect(body.id, 'devolver un id sin haber creado nada es el propio bug').toBeUndefined()
  })
})

describe('guardado de feature flags', () => {
  it('si la escritura falla, NO dice que se guardó', async () => {
    // Estas flags gobiernan Stripe, AdSense y Cookiebot: creer que has
    // activado un cobro que no está activo es el peor fallo posible aquí.
    const { PUT } = await import('@/app/api/admin/features/[key]/route')

    const res = await PUT(
      new NextRequest('http://localhost:3000/api/admin/features/feature.stripe', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: true, config: {} }),
      }),
      { params: Promise.resolve({ key: 'feature.stripe' }) },
    )

    expect(res.status).toBeGreaterThanOrEqual(500)
    expect((await res.json()).ok).toBe(false)
  })
})
