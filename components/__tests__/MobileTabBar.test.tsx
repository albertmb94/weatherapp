import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MobileTabBar, { type MobileTab } from '@/components/MobileTabBar'
import { LocaleProvider } from '@/lib/LocaleContext'

function renderBar(active: MobileTab = 'models') {
  const onChange = vi.fn()
  // Idioma EXPLICITO: antes el proveedor deducia el idioma de
  // navigator.language, que en jsdom es en-US, asi que estos tests
  // pasaban en ingles por accidente. Con el idioma en la ruta ya no se
  // deduce nada, y la dependencia oculta se vuelve visible.
  const utils = render(
    <LocaleProvider initialLocale="en">
      <MobileTabBar active={active} onChange={onChange} />
    </LocaleProvider>,
  )
  return { ...utils, onChange }
}

describe('MobileTabBar', () => {
  // B-NEW-37 (2026-08-18): 'map' tab removed from MobileTabBar in this
  // build, so the assertion that mentions the Map button is gone too.
  it('renders the two primary tabs (always present in any locale)', () => {
    renderBar()
    expect(screen.getByRole('button', { name: /Models/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Stations/i })).toBeInTheDocument()
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
    await user.click(screen.getByRole('button', { name: /Stations/i }))
    expect(onChange).toHaveBeenCalledWith('stations')
  })

  it('has a 44+ px min-height on each tab button', () => {
    renderBar()
    const btn = screen.getByRole('button', { name: /Models/i })
    expect(btn.className).toMatch(/min-h-\[52px\]/)
  })
})
