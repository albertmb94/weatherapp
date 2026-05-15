'use client'

interface TimeRangeOption {
  label: string
  hours: number
}

const RANGES: TimeRangeOption[] = [
  { label: '24h', hours: 24 },
  { label: '48h', hours: 48 },
  { label: '3d', hours: 72 },
  { label: '7d', hours: 168 },
  { label: '14d', hours: 336 },
]

interface TimeRangeSelectorProps {
  selected: number
  onChange: (hours: number) => void
  maxAvailable: number
}

export default function TimeRangeSelector({ selected, onChange, maxAvailable }: TimeRangeSelectorProps) {
  return (
    <div className="flex items-center gap-0.5">
      <span className="text-[10px] text-gray-600 mr-1">Range:</span>
      {RANGES.map(r => {
        const active = selected === r.hours
        const disabled = r.hours > maxAvailable
        return (
          <button
            key={r.hours}
            onClick={() => onChange(r.hours)}
            disabled={disabled}
            className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-all cursor-pointer ${
              disabled
                ? 'text-gray-800 cursor-not-allowed'
                : active
                  ? 'text-white'
                  : 'text-gray-600 hover:text-gray-300'
            }`}
          >
            {r.label}
          </button>
        )
      })}
    </div>
  )
}
