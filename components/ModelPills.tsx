'use client'

import type { WeatherModel } from '@/lib/models'

interface ModelPillsProps {
  models: WeatherModel[]
  selected: string[]
  onChange: (ids: string[]) => void
}

export default function ModelPills({ models, selected, onChange }: ModelPillsProps) {
  const allSelected = selected.length === models.length
  const noneSelected = selected.length === 0

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

  function selectNone() {
    onChange([])
  }

  return (
    <div className="flex items-center gap-0.5 flex-wrap">
      <button
        onClick={selectAll}
        className={`shrink-0 min-h-[32px] px-2 rounded text-[11px] font-medium transition-all cursor-pointer ${
          allSelected ? 'text-white' : 'text-gray-600 hover:text-gray-300'
        }`}
      >
        All
      </button>
      <button
        onClick={selectNone}
        className={`shrink-0 min-h-[32px] px-2 rounded text-[11px] font-medium transition-all cursor-pointer ${
          noneSelected ? 'text-white' : 'text-gray-600 hover:text-gray-300'
        }`}
      >
        None
      </button>
      <div className="w-px h-3 bg-gray-800 mx-0.5 shrink-0" />
      {models.map(m => {
        const active = selected.includes(m.id)
        return (
          <button
            key={m.id}
            onClick={() => toggle(m.id)}
            className={`shrink-0 min-h-[32px] px-2 rounded text-[11px] font-medium transition-all cursor-pointer flex items-center gap-1 ${
              active ? 'text-white' : 'text-gray-600 hover:text-gray-300'
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
  )
}
