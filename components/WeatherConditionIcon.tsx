'use client'

import type { WeatherIconId } from '@/lib/weatherIcon'

const ICONS: Record<WeatherIconId, React.ReactNode> = {
  sunny: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" className="w-5 h-5 text-amber-400">
      <circle cx="12" cy="12" r="4" fill="currentColor" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4" />
    </svg>
  ),
  partly: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" className="w-5 h-5 text-amber-300">
      <circle cx="9" cy="9" r="3" fill="currentColor" />
      <path d="M9 3v1.5M9 13.5V15M3 9h1.5M13.5 9H15M5 5l1 1M12 12l1 1M5 13l1-1M12 6l1-1" stroke="currentColor" strokeOpacity={0.7} />
      <path d="M9 17a3 3 0 0 1 .3-5.97A4 4 0 0 1 17 11.5a2.5 2.5 0 0 1 0 5z" fill="#9ca3af" stroke="#6b7280" />
    </svg>
  ),
  cloudy: (
    <svg viewBox="0 0 24 24" fill="#9ca3af" stroke="#6b7280" strokeWidth={1.5} strokeLinejoin="round" className="w-5 h-5">
      <path d="M6 16a4 4 0 0 1 .4-7.96A5 5 0 0 1 16 8.5a3 3 0 0 1 0 6z" />
    </svg>
  ),
  rainy: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" className="w-5 h-5 text-sky-400">
      <path d="M6 13a4 4 0 0 1 .4-7.96A5 5 0 0 1 16 5.5a3 3 0 0 1 0 6z" fill="#9ca3af" stroke="#6b7280" />
      <path d="M8 17l-1 3M12 17l-1 3M16 17l-1 3" />
    </svg>
  ),
  stormy: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" className="w-5 h-5 text-yellow-300">
      <path d="M6 13a4 4 0 0 1 .4-7.96A5 5 0 0 1 16 5.5a3 3 0 0 1 0 6z" fill="#6b7280" stroke="#4b5563" />
      <path d="M12 13l-2 5h3l-2 4" fill="currentColor" />
    </svg>
  ),
  snowy: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" className="w-5 h-5 text-sky-200">
      <path d="M6 13a4 4 0 0 1 .4-7.96A5 5 0 0 1 16 5.5a3 3 0 0 1 0 6z" fill="#cbd5e1" stroke="#94a3b8" />
      <path d="M9 17l1 3M13 17l1 3M11 18h2M9 19l2-1M13 19l-2-1" />
    </svg>
  ),
}

interface WeatherConditionIconProps {
  icon: WeatherIconId
  size?: 'sm' | 'md'
}

export default function WeatherConditionIcon({ icon, size = 'md' }: WeatherConditionIconProps) {
  const sizeClass = size === 'sm' ? 'w-4 h-4' : 'w-5 h-5'
  const node = ICONS[icon]
  if (!node) return <span className={`${sizeClass} inline-block`} />
  if (size === 'sm') {
    return <span className="[&_svg]:w-4 [&_svg]:h-4 inline-flex items-center justify-center">{node}</span>
  }
  return <span className="inline-flex items-center justify-center">{node}</span>
}
