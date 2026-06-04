import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import ConnectionStatus from '@/components/ConnectionStatus'

vi.mock('@/lib/useOnlineStatus', () => ({
  useOnlineStatus: vi.fn(),
}))

import { useOnlineStatus } from '@/lib/useOnlineStatus'
const mockUseOnlineStatus = vi.mocked(useOnlineStatus)

describe('ConnectionStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockUseOnlineStatus.mockReturnValue(true)
  })

  it('renders nothing when online', () => {
    render(<ConnectionStatus />)
    expect(screen.queryByText('No internet connection')).not.toBeInTheDocument()
  })

  it('shows banner after 1s delay when offline', () => {
    mockUseOnlineStatus.mockReturnValue(false)
    render(<ConnectionStatus />)

    expect(screen.queryByText('No internet connection')).not.toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(1000)
    })

    expect(screen.getByText('No internet connection')).toBeInTheDocument()
  })

  it('hides banner when coming back online', () => {
    mockUseOnlineStatus.mockReturnValue(false)
    const { rerender } = render(<ConnectionStatus />)

    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(screen.getByText('No internet connection')).toBeInTheDocument()

    mockUseOnlineStatus.mockReturnValue(true)
    rerender(<ConnectionStatus />)

    act(() => {
      vi.advanceTimersByTime(10)
    })

    expect(screen.queryByText('No internet connection')).not.toBeInTheDocument()
  })
})
