import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'
import ModelSelector from '../ModelSelector'
import { LocaleProvider } from '@/lib/LocaleContext'
import type { WeatherModel } from '@/lib/models'

const MODELS_FIXTURE: WeatherModel[] = [
  { id: 'ecmwf_ifs', label: 'ECMWF IFS', color: '#000', maxHours: 360, weight: 30, type: 'deterministic', region: 'global', resolution: 9 },
  { id: 'icon_global', label: 'ICON 13km', color: '#911eb4', maxHours: 240, weight: 18, type: 'deterministic', region: 'global', resolution: 13 },
  { id: 'gfs_global', label: 'GFS 13km', color: '#f032e6', maxHours: 384, weight: 14, type: 'deterministic', region: 'global', resolution: 13 },
]

function renderWithLocale(ui: React.ReactElement) {
  return render(<LocaleProvider initialLocale="es">{ui}</LocaleProvider>)
}

describe('ModelSelector', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders the WedAI / Models toggle', () => {
    renderWithLocale(
      <ModelSelector
        models={MODELS_FIXTURE}
        selected={['ecmwf_ifs']}
        onChange={() => {}}
      />,
    )
    expect(screen.getByRole('button', { name: 'WedAI' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Models' })).toBeInTheDocument()
  })

  it('hides the model dropdown in WedAI mode', () => {
    renderWithLocale(
      <ModelSelector
        models={MODELS_FIXTURE}
        selected={['ecmwf_ifs']}
        onChange={() => {}}
        ensembleMode="wedai"
      />,
    )
    // WedAI is the default; the dropdown trigger reads "All"
    // (selected.length === 0 in the test setup) but the dropdown
    // container is hidden because ensembleMode='wedai'.
    expect(screen.queryByText(/^ECMWF/)).not.toBeInTheDocument()
  })

  it('opens the model dropdown in Models mode and selects a single model', () => {
    const onChange = vi.fn()
    renderWithLocale(
      <ModelSelector
        models={MODELS_FIXTURE}
        selected={MODELS_FIXTURE.map(m => m.id)}
        onChange={onChange}
        ensembleMode="models"
      />,
    )
    // With every model active the trigger renders "All".
    fireEvent.click(screen.getByText(/^All$/))
    // Each model is listed.
    expect(screen.getByText('ECMWF IFS')).toBeInTheDocument()
    expect(screen.getByText('ICON 13km')).toBeInTheDocument()
    // Clicking a single model narrows the selection.
    act(() => {
      fireEvent.click(screen.getByText('ICON 13km'))
    })
    expect(onChange).toHaveBeenCalledWith(['icon_global'])
  })

  it('toggle fires the onEnsembleModeChange callback', () => {
    const onChange = vi.fn()
    const onModeChange = vi.fn()
    renderWithLocale(
      <ModelSelector
        models={MODELS_FIXTURE}
        selected={['ecmwf_ifs']}
        onChange={onChange}
        onEnsembleModeChange={onModeChange}
        ensembleMode="wedai"
      />,
    )
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Models' }))
    })
    expect(onModeChange).toHaveBeenCalledWith('models')
  })

  // End of describe block.
})
