import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ModelSelector from '@/components/ModelSelector'
import { MODELS } from '@/lib/models'

// ModelSelector's per-model picker only renders in 'models' ensemble mode.
const PROPS = {
  ensembleMode: 'models' as const,
  onEnsembleModeChange: () => undefined,
}

describe('ModelSelector (models mode)', () => {
  it('renders the All button but no None button', () => {
    render(
      <ModelSelector
        models={MODELS}
        selected={MODELS.map(m => m.id)}
        onChange={vi.fn()}
        {...PROPS}
      />
    )
    expect(screen.getByText('All')).toBeInTheDocument()
    expect(screen.queryByText('None')).not.toBeInTheDocument()
  })

  it('renders the dropdown label as All when all models are selected', () => {
    render(
      <ModelSelector
        models={MODELS}
        selected={MODELS.map(m => m.id)}
        onChange={vi.fn()}
        {...PROPS}
      />
    )
    expect(screen.getByText('All')).toBeInTheDocument()
  })

  it('calls onChange with all models when All is clicked', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(
      <ModelSelector
        models={MODELS}
        selected={['gfs_global']}
        onChange={onChange}
        {...PROPS}
      />
    )

    // Dropdown collapsed on first paint; click the toggle (which shows
    // the single-model label "GFS") to open it, then click All.
    await user.click(screen.getByText('GFS'))
    await user.click(screen.getByText('All'))
    expect(onChange).toHaveBeenCalledWith(MODELS.map(m => m.id))
  })

  it('selectOnly isolates a single model when multiple are selected', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(
      <ModelSelector
        models={MODELS}
        selected={MODELS.map(m => m.id)}
        onChange={onChange}
        {...PROPS}
      />
    )

    await user.click(screen.getByText('All'))
    await user.click(screen.getByText('GFS 13km'))
    expect(onChange).toHaveBeenCalledWith(['gfs_global'])
  })

  it('selectOnly deselects to all when single model is already selected', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(
      <ModelSelector
        models={MODELS}
        selected={['gfs_global']}
        onChange={onChange}
        {...PROPS}
      />
    )

    // Open the dropdown first by clicking the "GFS" toggle, then pick
    // the same model again to flip back to all-selected.
    await user.click(screen.getByText('GFS'))
    await user.click(screen.getByText('GFS 13km'))
    expect(onChange).toHaveBeenCalledWith(MODELS.map(m => m.id))
  })
})
