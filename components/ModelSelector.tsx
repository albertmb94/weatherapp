'use client'

import type { WeatherModel } from '@/lib/models'

interface ModelSelectorProps {
  models: WeatherModel[]
  selected: string[]
  onChange: (ids: string[]) => void
}

export default function ModelSelector({ models, selected, onChange }: ModelSelectorProps) {
  const allSelected = selected.length === models.length

  function toggle(id: string) {
    if (selected.includes(id)) {
      onChange(selected.filter(s => s !== id))
    } else {
      onChange([...selected, id])
    }
  }

  function selectAll() {
    onChange(models.map(m => m.id))
  }

  return (
    <div className="mb-3 animate-fadeIn">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-gray-400">Models</span>
          <span className="text-[10px] text-gray-600">
            ({selected.length}/{models.length})
          </span>
        </div>
        <button
          onClick={selectAll}
          className={`shrink-0 min-h-[28px] px-2 rounded text-[11px] font-medium transition-all cursor-pointer ${
            allSelected ? 'text-white' : 'text-gray-600 hover:text-gray-300'
          }`}
        >
          All
        </button>
      </div>

      <div className="flex items-center gap-0.5 flex-wrap mt-1.5">
        {models.map(m => {
          const active = selected.includes(m.id)
          return (
            <button
              key={m.id}
              onClick={() => toggle(m.id)}
              className={`shrink-0 min-h-[36px] px-2.5 rounded text-[11px] font-medium transition-all cursor-pointer flex items-center gap-1.5 ${
                active ? 'text-white' : 'text-gray-600 hover:text-gray-400'
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
    </div>
  )
}
