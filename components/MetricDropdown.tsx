'use client'

import type { Metric, MetricId } from '@/lib/models'

interface MetricDropdownProps {
  metrics: Metric[]
  selected: MetricId
  onChange: (id: MetricId) => void
}

export default function MetricDropdown({ metrics, selected, onChange }: MetricDropdownProps) {
  return (
    <select
      value={selected}
      onChange={e => onChange(e.target.value as MetricId)}
      className="px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-blue-500 cursor-pointer"
    >
      {metrics.map(m => (
        <option key={m.id} value={m.id}>
          {m.label} ({m.unit})
        </option>
      ))}
    </select>
  )
}
