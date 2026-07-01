import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ModelSelector from '@/components/ModelSelector'
import { MODELS } from '@/lib/models'

describe('ModelSelector', () => {
  it('renders the All button but no None button', () => {
    render(<ModelSelector models={MODELS} selected={MODELS.map(m => m.id)} onChange={vi.fn()} />)
    expect(screen.getByText('All')).toBeInTheDocument()
    expect(screen.queryByText('None')).not.toBeInTheDocument()
  })

  it('renders all model buttons', () => {
    render(<ModelSelector models={MODELS} selected={MODELS.map(m => m.id)} onChange={vi.fn()} />)
    for (const m of MODELS) {
      expect(screen.getAllByText(m.label.split(' ')[0]).length).toBeGreaterThanOrEqual(1)
    }
  })

  it('calls onChange with all models when All is clicked', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<ModelSelector models={MODELS} selected={['gfs_global']} onChange={onChange} />)

    await user.click(screen.getByText('All'))
    expect(onChange).toHaveBeenCalledWith(MODELS.map(m => m.id))
  })

  it('selectOnly isolates a single model when multiple are selected', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<ModelSelector models={MODELS} selected={MODELS.map(m => m.id)} onChange={onChange} />)

    await user.click(screen.getByText('GFS'))
    expect(onChange).toHaveBeenCalledWith(['gfs_global'])
  })

  it('selectOnly deselects to all when single model is already selected', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<ModelSelector models={MODELS} selected={['gfs_global']} onChange={onChange} />)

    await user.click(screen.getByText('GFS'))
    expect(onChange).toHaveBeenCalledWith(MODELS.map(m => m.id))
  })
})
