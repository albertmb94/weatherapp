import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchWithTimeout } from '../fetchWithTimeout'

describe('fetchWithTimeout', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('calls fetch with correct url and options', async () => {
    const mockResponse = new Response('ok')
    vi.mocked(fetch).mockResolvedValue(mockResponse)

    const result = await fetchWithTimeout('/api/test', { method: 'GET' })
    expect(result).toBe(mockResponse)
    expect(fetch).toHaveBeenCalledWith('/api/test', expect.objectContaining({ method: 'GET' }))
  })

  it('throws error after timeout', async () => {
    vi.mocked(fetch).mockImplementation((_url, opts) => {
      const signal = (opts as RequestInit)?.signal as AbortSignal | undefined
      return new Promise((resolve, reject) => {
        if (signal) {
          signal.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'))
          })
        }
      })
    })

    await expect(fetchWithTimeout('/api/slow', { timeoutMs: 50 }))
      .rejects.toThrow('Request timed out after 50ms')
  }, 10000)

  it('throws immediately if signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(
      fetchWithTimeout('/api/test', { signal: controller.signal })
    ).rejects.toThrow()
  })

  it('propagates fetch errors', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('Network error'))

    await expect(fetchWithTimeout('/api/test')).rejects.toThrow('Network error')
  })

  it('returns response on success', async () => {
    const mockResponse = new Response(JSON.stringify({ data: 42 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
    vi.mocked(fetch).mockResolvedValue(mockResponse)

    const res = await fetchWithTimeout('/api/test')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ data: 42 })
  })
})
