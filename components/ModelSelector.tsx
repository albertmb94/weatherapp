'use client'

import type { WeatherModel } from '@/lib/models'

interface ModelSelectorProps {
  models: WeatherModel[]
  selected: string | null
  onChange: (id: string | null) => void
}

export default function ModelSelector({ models, selected, onChange }: ModelSelectorProps) {
  return (
    <select
      value={selected ?? ''}
      onChange={e => onChange(e.target.value || null)}
      className="px-3 py-1.5 bg-gray-800 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500 cursor-pointer"
    >
      <option value="">All Models</option>
      {models.map(m => (
        <option key={m.id} value={m.id}>
          {m.label} ({m.weight}%)
        </option>
      ))}
    </select>
  )
}
