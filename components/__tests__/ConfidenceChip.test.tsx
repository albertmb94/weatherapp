import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import ConfidenceChip from '../ConfidenceChip'
import { LocaleProvider } from '@/lib/LocaleContext'

function renderWithLocale(node: React.ReactNode) {
  return render(<LocaleProvider initialLocale="es">{node}</LocaleProvider>)
}

describe('ConfidenceChip', () => {
  it('renders the high-confidence label in Spanish by default', () => {
    renderWithLocale(<ConfidenceChip level="high" />)
    expect(screen.getByText('Alta')).toBeInTheDocument()
  })

  it('renders the spread suffix when provided', () => {
    renderWithLocale(<ConfidenceChip level="low" spreadLabel="±3.0" />)
    expect(screen.getByText('±3.0')).toBeInTheDocument()
  })

  it('marks the chip as aria-live polite (screen reader announces changes)', () => {
    renderWithLocale(<ConfidenceChip level="medium" />)
    const chip = screen.getByText(/Media/i).closest('span')
    expect(chip).not.toBeNull()
    expect((chip as HTMLElement).getAttribute('aria-live')).toBe('polite')
  })
})
