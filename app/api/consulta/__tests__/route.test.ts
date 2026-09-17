import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/rateLimit', () => ({
  rateLimit: vi.fn(() => true),
}))

vi.mock('@/lib/typesafe', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/typesafe')>()
  return {
    ...actual,
    isTypeSafeConfigured: vi.fn(() => true),
    getTypeSafeClient: vi.fn(),
  }
})

import { POST } from '@/app/api/consulta/route'
import { rateLimit } from '@/lib/rateLimit'
import {
  APIError,
  RateLimitError,
  getTypeSafeClient,
  isTypeSafeConfigured,
  type TypeSafeClient,
} from '@/lib/typesafe'

function request(body?: unknown): Request {
  return new Request('http://localhost/api/consulta', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

function mockSystemOne(impl: (() => Promise<unknown>) | unknown) {
  const systemOne =
    typeof impl === 'function' ? vi.fn(impl as () => Promise<unknown>) : vi.fn().mockResolvedValue(impl)
  vi.mocked(getTypeSafeClient).mockReturnValue({ systemOne } as unknown as TypeSafeClient)
  return systemOne
}

const OK_RESULT = {
  model: 'jev-1.13.0',
  answers: {
    es_meteo: { type: 'noul', noul: 0.97 },
    tema: { type: 'choice', choice: 'lluvia', confidence: 0.9, probabilities: { lluvia: 1 } },
    horizonte: { type: 'choice', choice: 'manana', confidence: 0.8, probabilities: { manana: 1 } },
    franja: { type: 'choice', choice: 'tarde', confidence: 0.7, probabilities: { tarde: 1 } },
    lugar: { type: 'choice', choice: 'girona', confidence: 0.95, probabilities: { girona: 1 } },
  },
  usage: { input_tokens: 100, output_tokens: 20 },
}

describe('/api/consulta POST', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(rateLimit).mockReturnValue(true)
    vi.mocked(isTypeSafeConfigured).mockReturnValue(true)
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('returns 429 when rate limited', async () => {
    vi.mocked(rateLimit).mockReturnValue(false)
    const res = await POST(request({ q: '¿va a llover?' }))
    expect(res.status).toBe(429)
  })

  it('returns 400 on an invalid JSON body', async () => {
    const res = await POST(request('not-json'))
    expect(res.status).toBe(400)
  })

  it('returns 400 when q is missing or blank', async () => {
    expect((await POST(request({}))).status).toBe(400)
    expect((await POST(request({ q: '   ' }))).status).toBe(400)
  })

  it('returns 400 when q is too long', async () => {
    const res = await POST(request({ q: 'a'.repeat(501) }))
    expect(res.status).toBe(400)
  })

  it('returns 503 without calling TypeSafe when unconfigured', async () => {
    vi.mocked(isTypeSafeConfigured).mockReturnValue(false)
    const res = await POST(request({ q: '¿va a llover?' }))
    expect(res.status).toBe(503)
    expect((await res.json()).configured).toBe(false)
    expect(getTypeSafeClient).not.toHaveBeenCalled()
  })

  it('maps answers into typed params', async () => {
    const systemOne = mockSystemOne(OK_RESULT)
    const res = await POST(
      request({
        q: '¿va a llover el sábado por la tarde en Girona?',
        candidatos: [{ id: 'girona', nombre: 'Girona' }],
      }),
    )
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.params.esConsultaMeteo).toBe(true)
    expect(data.params.tema).toBe('precipitation')
    expect(data.params.horizonteDias).toBe(2)
    expect(data.params.lugar).toEqual({ id: 'girona', nombre: 'Girona' })
    expect(data.modelo).toBe('jev-1.13.0')
    expect(data.uso).toEqual({ entrada: 100, salida: 20 })

    const arg = (systemOne.mock.calls as unknown[][])[0][0] as {
      questions: { es_meteo: { type: string }; lugar: { criteria: Record<string, string> } }
    }
    expect(arg.questions.es_meteo.type).toBe('noul')
    expect(arg.questions.lugar.criteria.girona).toBe('Girona')
  })

  it('returns 502 when TypeSafe fails with an APIError', async () => {
    mockSystemOne(() => Promise.reject(new APIError(500, {}, new Headers(), 'boom')))
    const res = await POST(request({ q: '¿va a llover?' }))
    expect(res.status).toBe(502)
  })

  it('propagates a TypeSafe rate limit as 429', async () => {
    mockSystemOne(() => Promise.reject(new RateLimitError(429, {}, new Headers())))
    const res = await POST(request({ q: '¿va a llover?' }))
    expect(res.status).toBe(429)
  })
})
