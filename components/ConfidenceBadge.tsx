'use client'

import { useLocale } from '@/lib/LocaleContext'
import { STRINGS } from '@/lib/i18n'

interface ConfidenceBadgeProps {
  level: 'high' | 'medium' | 'low'
  className?: string
}

const LEVEL_CONFIG = {
  high: { color: 'bg-emerald-500', text: 'text-emerald-300', label: 'confidenceHigh' as const },
  medium: { color: 'bg-yellow-500', text: 'text-yellow-300', label: 'confidenceMedium' as const },
  low: { color: 'bg-red-500', text: 'text-red-300', label: 'confidenceLow' as const },
}

export default function ConfidenceBadge({ level, className = '' }: ConfidenceBadgeProps) {
  const { locale } = useLocale()
  const s = STRINGS[locale]
  const config = LEVEL_CONFIG[level]

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${config.text} bg-surface border border-border ${className}`}
      title={s.confidenceTooltip}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${config.color}`} />
      {s[config.label]}
    </span>
  )
}
