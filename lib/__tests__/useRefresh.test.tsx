import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useRefresh } from '../useRefresh'

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
  return Wrapper
}

describe('useRefresh', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('refresh() posts exactly once per click beyond the status probe', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve({ skipped: false, refreshedAt: 1 }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useRefresh(), { wrapper: createWrapper() })
    // S4 added an internal status query that fires on mount; consume
    // the initial mount fetch before counting the user click.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    fetchMock.mockClear()

    await act(async () => {
      result.current.refresh()
    })

    // The user click triggers exactly one POST /api/refresh.
    const postCalls = fetchMock.mock.calls.filter(
      (call) => (call[1] as RequestInit | undefined)?.method === 'POST',
    )
    expect(postCalls.length).toBe(1)
  })

  it('reports refreshed outcome on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve({ skipped: false, refreshedAt: 12345 }),
    }))

    const { result } = renderHook(() => useRefresh(), { wrapper: createWrapper() })

    await act(async () => {
      result.current.refresh()
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(result.current.lastOutcome?.kind).toBe('refreshed')
    expect(result.current.isPending).toBe(false)
  })

  it('reports cooldown outcome when server returns skipped', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve({
        skipped: true, reason: 'cooldown', cooldownMs: 14400000, ageMs: 60_000,
      }),
    }))

    const { result } = renderHook(() => useRefresh(), { wrapper: createWrapper() })

    await act(async () => {
      result.current.refresh()
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(result.current.lastOutcome?.kind).toBe('cooldown')
    if (result.current.lastOutcome?.kind === 'cooldown') {
      expect(result.current.lastOutcome.remainingMs).toBe(14340000)
    }
  })
})
