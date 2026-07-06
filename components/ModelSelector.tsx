'use client'

import type { WeatherModel } from '@/lib/models'

interface ModelSelectorProps {
  models: WeatherModel[]
  selected: string[]
  onChange: (ids: string[]) => void
  ensembleMode?: 'wedai' | 'models'
  onEnsembleModeChange?: (mode: 'wedai' | 'models') => void
}

export default function ModelSelector({ models, selected, onChange, ensembleMode = 'wedai', onEnsembleModeChange }: ModelSelectorProps) {
  const allSelected = selected.length === models.length

  function selectOnly(id: string) {
    if (selected.length === 1 && selected.includes(id)) {
      onChange(models.map(m => m.id))
    } else {
      onChange([id])
    }
  }

  function selectAll() {
    onChange(models.map(m => m.id))
  }

  return (
    <div className="mb-3 animate-fadeIn">
      {/* WedAI / Models toggle */}
      <div className="flex items-center gap-1 mb-2">
        <button
          type="button"
          onClick={() => onEnsembleModeChange?.('wedai')}
          className={`px-3 py-1 rounded-full text-[11px] font-semibold cursor-pointer transition-colors min-h-[28px] border ${
            ensembleMode === 'wedai'
              ? 'bg-accent text-white border-accent'
              : 'bg-surface-popover text-text-secondary border-border hover:text-text-primary'
          }`}
        >
          WedAI
        </button>
        <button
          type="button"
          onClick={() => onEnsembleModeChange?.('models')}
          className={`px-3 py-1 rounded-full text-[11px] font-semibold cursor-pointer transition-colors min-h-[28px] border ${
            ensembleMode === 'models'
              ? 'bg-accent text-white border-accent'
              : 'bg-surface-popover text-text-secondary border-border hover:text-text-primary'
          }`}
        >
          Models
        </button>
      </div>

      {/* Model chips (only visible in 'models' mode) */}
      {ensembleMode === 'models' && (
        <div className="flex items-center gap-0.5 flex-nowrap overflow-x-auto md:flex-wrap md:overflow-visible scrollbar-none">
          <button
            onClick={selectAll}
            className={`shrink-0 min-h-[36px] px-2 rounded text-[11px] font-medium transition-all cursor-pointer ${
              allSelected ? 'text-text-primary' : 'text-text-tertiary hover:text-text-secondary'
            }`}
          >
            All
          </button>
          <div className="w-px h-3 bg-border mx-0.5 shrink-0" />
          {models.map(m => {
            const active = selected.includes(m.id)
            return (
              <button
                key={m.id}
                onClick={() => selectOnly(m.id)}
                className={`shrink-0 min-h-[36px] px-2.5 rounded text-[11px] font-medium transition-all cursor-pointer flex items-center gap-1.5 ${
                  active ? 'text-text-primary' : 'text-text-tertiary hover:text-text-secondary'
                }`}
                title={`${m.label} (${m.weight}%)`}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full inline-block shrink-0"
                  style={{ backgroundColor: active ? m.color : '#444' }}
                />
                <span>{m.label.split(' ')[0]}</span>
              </button>
            )
          })}
        </div>
      )}

      {/* WedAI info (only visible in 'wedai' mode) */}
      {ensembleMode === 'wedai' && (
        <div className="text-[10px] text-text-muted px-1">
          Ensemble optimizado: Temperatura + Precipitación + Detección lluvia
        </div>
      )}
    </div>
  )
}
