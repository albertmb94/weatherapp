import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MobileTabBar, { type MobileTab } from '@/components/MobileTabBar'
import { LocaleProvider } from '@/lib/LocaleContext'

function renderBar(active: MobileTab = 'models') {
  const onChange = vi.fn()
  const utils = render(
    <LocaleProvider>
      <MobileTabBar active={active} onChange={onChange} />
    </LocaleProvider>,
  )
  return { ...utils, onChange }
}

describe('MobileTabBar', () => {
  it('renders the three primary tabs (always present in any locale)', () => {
    renderBar()
    expect(screen.getByRole('button', { name: /Models/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Stations/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Map/i })).toBeInTheDocument()
  })

  it('marks the active tab as current', () => {
    renderBar('stations')
    const stationsBtn = screen.getByRole('button', { name: /Stations/i })
    expect(stationsBtn).toHaveAttribute('aria-current', 'page')
    const modelsBtn = screen.getByRole('button', { name: /Models/i })
    expect(modelsBtn).not.toHaveAttribute('aria-current')
  })

  it('forwards the click to onChange with the right tab id', async () => {
    const user = userEvent.setup()
    const { onChange } = renderBar('models')
    await user.click(screen.getByRole('button', { name: /Map/i }))
    expect(onChange).toHaveBeenCalledWith('map')
  })

  it('has a 44+ px min-height on each tab button', () => {
    renderBar()
    const btn = screen.getByRole('button', { name: /Models/i })
    expect(btn.className).toMatch(/min-h-\[52px\]/)
  })
})
