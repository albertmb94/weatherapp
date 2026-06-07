import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MetricPills from '@/components/MetricPills'
import { METRICS } from '@/lib/models'

describe('MetricPills', () => {
  it('renders all metrics', () => {
    render(<MetricPills metrics={METRICS} selected="temperature" onChange={vi.fn()} />)
    for (const m of METRICS) {
      expect(screen.getByTitle(m.label)).toBeInTheDocument()
    }
  })

  it('marks selected metric as pressed', () => {
    render(<MetricPills metrics={METRICS} selected="temperature" onChange={vi.fn()} />)
    const tempBtn = screen.getByTitle('Temperature')
    expect(tempBtn).toHaveAttribute('aria-pressed', 'true')
  })

  it('calls onChange when metric is clicked', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<MetricPills metrics={METRICS} selected="temperature" onChange={onChange} />)

    await user.click(screen.getByTitle('Wind Speed'))
    expect(onChange).toHaveBeenCalledWith('wind_speed')
  })

  it('non-selected metrics have aria-pressed false', () => {
    render(<MetricPills metrics={METRICS} selected="temperature" onChange={vi.fn()} />)
    const windBtn = screen.getByTitle('Wind Speed')
    expect(windBtn).toHaveAttribute('aria-pressed', 'false')
  })

  it('filters to land group when group="land"', () => {
    render(<MetricPills metrics={METRICS} selected="temperature" onChange={vi.fn()} group="land" />)
    expect(screen.getByTitle('Temperature')).toBeInTheDocument()
    expect(screen.getByTitle('Wind Speed')).toBeInTheDocument()
    expect(screen.queryByTitle('Wave Height')).not.toBeInTheDocument()
  })

  it('filters to marine group when group="marine"', () => {
    render(<MetricPills metrics={METRICS} selected="wave_height" onChange={vi.fn()} group="marine" />)
    expect(screen.getByTitle('Wave Height')).toBeInTheDocument()
    expect(screen.getByTitle('Wave Period')).toBeInTheDocument()
    expect(screen.queryByTitle('Temperature')).not.toBeInTheDocument()
  })
})
