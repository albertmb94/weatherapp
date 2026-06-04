import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TimeRangeSelector from '@/components/TimeRangeSelector'

describe('TimeRangeSelector', () => {
  it('renders all time range options', () => {
    render(<TimeRangeSelector selected={24} onChange={vi.fn()} maxAvailable={336} />)
    expect(screen.getByText('24h')).toBeInTheDocument()
    expect(screen.getByText('48h')).toBeInTheDocument()
    expect(screen.getByText('3d')).toBeInTheDocument()
    expect(screen.getByText('7d')).toBeInTheDocument()
    expect(screen.getByText('14d')).toBeInTheDocument()
  })

  it('marks selected option', () => {
    render(<TimeRangeSelector selected={48} onChange={vi.fn()} maxAvailable={336} />)
    expect(screen.getByText('48h')).toHaveClass('text-white')
  })

  it('disables options exceeding maxAvailable', () => {
    render(<TimeRangeSelector selected={24} onChange={vi.fn()} maxAvailable={48} />)
    expect(screen.getByText('24h')).not.toBeDisabled()
    expect(screen.getByText('48h')).not.toBeDisabled()
    expect(screen.getByText('3d')).toBeDisabled()
    expect(screen.getByText('7d')).toBeDisabled()
    expect(screen.getByText('14d')).toBeDisabled()
  })

  it('calls onChange when option is clicked', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<TimeRangeSelector selected={24} onChange={onChange} maxAvailable={336} />)

    await user.click(screen.getByText('7d'))
    expect(onChange).toHaveBeenCalledWith(168)
  })

  it('does not call onChange when disabled option is clicked', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<TimeRangeSelector selected={24} onChange={onChange} maxAvailable={48} />)

    await user.click(screen.getByText('7d'))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('hides label when showLabel is false', () => {
    render(<TimeRangeSelector selected={24} onChange={vi.fn()} maxAvailable={336} showLabel={false} />)
    expect(screen.queryByText('Range:')).not.toBeInTheDocument()
  })
})
