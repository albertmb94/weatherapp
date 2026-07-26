import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ProfilePicker, { PROFILE_ORDER } from '../ProfilePicker'
import { LocaleProvider } from '@/lib/LocaleContext'

function renderPicker(ui: React.ReactElement) {
  return render(<LocaleProvider initialLocale="es">{ui}</LocaleProvider>)
}

describe('ProfilePicker', () => {
  it('renders the profile selector and fires onChange on selection', () => {
    const onChange = vi.fn()
    renderPicker(
      <ProfilePicker value="plain" onChange={onChange} />,
    )
    const select = screen.getByRole('combobox') as HTMLSelectElement
    expect(select.value).toBe('plain')
    fireEvent.change(select, { target: { value: 'sailing' } })
    expect(onChange).toHaveBeenCalledWith('sailing')
  })

  it('lists every profile in PROFILE_ORDER', () => {
    renderPicker(<ProfilePicker value="plain" onChange={() => {}} />)
    const options = Array.from(
      screen.getByRole('combobox').querySelectorAll('option'),
    ).map(o => (o as HTMLOptionElement).value)
    expect(options).toEqual(PROFILE_ORDER)
  })

  it('renders the active recommendation in the active locale', () => {
    const rec = {
      plain: 'Equilibrio global, sin sesgo regional.',
      sailing: 'Viento, ráfagas y oleaje prioritarios.',
    }
    Object.entries(rec).forEach(([profile, expected]) => {
      const { unmount, container } = renderPicker(
        <ProfilePicker value={profile as 'plain'} onChange={() => {}} />,
      )
      expect(container.textContent).toContain(expected)
      unmount()
    })
  })
})
