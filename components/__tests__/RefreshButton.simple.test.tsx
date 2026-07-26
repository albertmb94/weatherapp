import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import RefreshButton from '../RefreshButton'
import { LocaleProvider } from '@/lib/LocaleContext'

function renderBtn() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <LocaleProvider initialLocale="es">
        <RefreshButton />
      </LocaleProvider>
    </QueryClientProvider>,
  )
}

describe('RefreshButton (smoke)', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('mounts and renders an action button', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ canRefresh: true, cooldownMs: 0 }),
    }))
    const { container } = renderBtn()
    expect(container.querySelector('button')).not.toBeNull()
  })

  it('button is clickable', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ canRefresh: true, cooldownMs: 0 }),
    }))
    renderBtn()
    const btn = document.querySelector('button') as HTMLButtonElement
    fireEvent.click(btn)
    expect(btn).toBeInstanceOf(HTMLButtonElement)
  })
})
