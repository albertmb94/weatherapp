import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * Rutas públicas que sin tope se pueden usar en bucle.
 *
 * No todas las rutas necesitan límite, pero éstas sí y no lo tenían:
 *
 *  - los tres creadores de sesión de Stripe (dos checkout y el portal):
 *    CADA petición crea una sesión en la cuenta de Stripe y consume su
 *    cuota de API. Agotarla no es ruido: es que el día que pase, quien
 *    quiere pagar no puede.
 *  - `premium/claim` y `newsletter/confirm`: cada intento es una consulta
 *    a la base y un intento de acertar un token.
 *  - `affiliates/serve`: lectura pública con consulta a la base en cada
 *    llamada.
 *
 * El test comprueba lo único que importa desde fuera: al agotar el cupo,
 * la ruta corta ANTES de hacer el trabajo caro.
 */

const { rateLimitMock } = vi.hoisted(() => ({ rateLimitMock: vi.fn(() => true) }))
vi.mock('@/lib/rateLimit', () => ({ rateLimit: rateLimitMock }))

// Todo lo caro, simulado: si algo de esto se llega a invocar con el cupo
// agotado, el límite no está donde debe.
const { stripeCrear, tokenExiste, confirmar, listar } = vi.hoisted(() => ({
  stripeCrear: vi.fn(),
  tokenExiste: vi.fn(async () => true),
  confirmar: vi.fn(async () => true),
  listar: vi.fn(async () => []),
}))

vi.mock('stripe', () => ({
  default: class {
    checkout = { sessions: { create: stripeCrear } }
    billingPortal = { sessions: { create: stripeCrear } }
    customers = { list: stripeCrear, create: stripeCrear }
  },
}))
vi.mock('@/lib/entitlements', () => ({
  entitlementTokenExists: tokenExiste,
  findEmailByToken: vi.fn(async () => null),
  ENTITLEMENT_COOKIE_NAME: 'wthr_ent',
  ENTITLEMENT_TOKEN_TTL_MS: 2592000000,
  resolveEntitlements: vi.fn(async () => ({ hasAny: false })),
}))
vi.mock('@/lib/newsletter', () => ({
  confirmSubscriber: confirmar,
  isValidEmail: () => true,
}))
vi.mock('@/lib/affiliate', () => ({ listAffiliateProducts: listar }))
vi.mock('@/lib/analytics', () => ({ linkVisitorIdentity: vi.fn() }))

function post(url: string, cuerpo?: BodyInit): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'x-forwarded-for': '203.0.113.7' },
    ...(cuerpo === undefined ? {} : { body: cuerpo }),
  })
}
function get(url: string): NextRequest {
  return new NextRequest(url, { headers: { 'x-forwarded-for': '203.0.113.7' } })
}

beforeEach(() => {
  vi.clearAllMocks()
  rateLimitMock.mockReturnValue(true)
})

describe('rutas con coste que ahora sí tienen tope', () => {
  it('premium/checkout no llama a Stripe con el cupo agotado', async () => {
    const { POST } = await import('@/app/api/premium/checkout/route')
    rateLimitMock.mockReturnValue(false)

    const res = await POST(post('http://localhost:3000/api/premium/checkout'))

    expect(res.status).toBe(429)
    expect(stripeCrear, 'crear la sesión es lo caro: no debe llegar').not.toHaveBeenCalled()
  })

  it('stations/checkout no llama a Stripe con el cupo agotado', async () => {
    const { POST } = await import('@/app/api/stations/checkout/route')
    rateLimitMock.mockReturnValue(false)

    const res = await POST(post('http://localhost:3000/api/stations/checkout'))

    expect(res.status).toBe(429)
    expect(stripeCrear).not.toHaveBeenCalled()
  })

  it('stripe/portal no llama a Stripe con el cupo agotado', async () => {
    const { GET } = await import('@/app/api/stripe/portal/route')
    rateLimitMock.mockReturnValue(false)

    const res = await GET(get('http://localhost:3000/api/stripe/portal'))

    expect(res.status).toBe(429)
    expect(stripeCrear).not.toHaveBeenCalled()
  })

  it('premium/claim no consulta la base con el cupo agotado', async () => {
    const { POST } = await import('@/app/api/premium/claim/route')
    rateLimitMock.mockReturnValue(false)

    const res = await POST(post('http://localhost:3000/api/premium/claim', new FormData()))

    // Redirige (303) porque esta ruta viene de un formulario nativo.
    expect(res.status).toBe(303)
    expect(String(res.headers.get('location'))).toContain('error=rate')
    expect(tokenExiste, 'comprobar el token es lo que se quiere acotar').not.toHaveBeenCalled()
  })

  it('newsletter/confirm no consulta la base con el cupo agotado', async () => {
    const { GET } = await import('@/app/api/newsletter/confirm/route')
    rateLimitMock.mockReturnValue(false)

    await GET(get('http://localhost:3000/api/newsletter/confirm?email=a@b.com&token=x'))

    expect(confirmar).not.toHaveBeenCalled()
  })

  it('affiliates/serve no consulta la base con el cupo agotado', async () => {
    const { GET } = await import('@/app/api/affiliates/serve/route')
    rateLimitMock.mockReturnValue(false)

    const res = await GET(get('http://localhost:3000/api/affiliates/serve?trigger=slot_uv'))

    expect(res.status).toBe(429)
    expect(listar).not.toHaveBeenCalled()
  })

  it('con cupo disponible, las rutas siguen funcionando', async () => {
    // El tope no puede ser una forma elegante de romper la ruta.
    const { GET } = await import('@/app/api/affiliates/serve/route')
    rateLimitMock.mockReturnValue(true)

    const res = await GET(get('http://localhost:3000/api/affiliates/serve?trigger=slot_uv'))

    expect(res.status).toBe(200)
    expect(listar).toHaveBeenCalled()
  })
})
