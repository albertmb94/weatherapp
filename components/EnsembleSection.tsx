'use client'

import { memo } from 'react'
import { useLocale } from '@/lib/LocaleContext'
import { STRINGS } from '@/lib/i18n'
import { ENSEMBLE_PRESETS, METRIC_TO_ENSEMBLE, getLeadTimeBucket } from '@/lib/models'
import ModelAccuracyPanel from './ModelAccuracyPanel'

interface AccuracyRecord {
  model_id: string
  mae: number | null
  rmse: number | null
  bias: number | null
  sample_count: number
}

interface EnsembleSectionProps {
  accuracyRecords: AccuracyRecord[]
  selectedMetric: string
  bucket: number
}

const EnsembleSection = memo(function EnsembleSection({
  accuracyRecords,
  selectedMetric,
  bucket,
}: EnsembleSectionProps) {
  const { locale } = useLocale()
  const s = STRINGS[locale]

  const presetId = METRIC_TO_ENSEMBLE[selectedMetric] ?? 'temperature'
  const preset = ENSEMBLE_PRESETS.find(p => p.id === presetId) ?? ENSEMBLE_PRESETS[0]
  const leadBucket = getLeadTimeBucket(bucket * 24)
  const currentWeights = preset.weights[leadBucket] ?? preset.weights['0-48h']

  return (
    <div className="space-y-3">
      <h3 className="text-[11px] uppercase tracking-widest text-text-tertiary font-semibold">
        {s.navAdvanced} &gt; Ensemble
      </h3>

      {/* Current ensemble weights */}
      <div className="rounded-2xl border border-border bg-surface-raised p-4">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-xs font-semibold text-text-primary">
            {preset.label} Ensemble
          </h4>
          <span className="text-[10px] text-text-muted px-2 py-0.5 rounded-full bg-surface border border-border">
            {leadBucket}
          </span>
        </div>
        <p className="text-[10px] text-text-tertiary mb-3">{preset.description}</p>
        <div className="space-y-1.5">
          {Object.entries(currentWeights)
            .sort(([, a], [, b]) => b - a)
            .map(([modelId, weight]) => (
              <div key={modelId} className="flex items-center gap-2">
                <div className="w-24 text-[10px] text-text-secondary truncate">{modelId}</div>
                <div className="flex-1 h-1.5 bg-surface rounded-full overflow-hidden">
                  <div
                    className="h-full bg-accent rounded-full transition-all"
                    style={{ width: `${weight * 100}%` }}
                  />
                </div>
                <div className="w-10 text-[10px] text-text-tertiary text-right tabular-nums">
                  {(weight * 100).toFixed(0)}%
                </div>
              </div>
            ))}
        </div>
      </div>

      {/* Accuracy panel */}
      <ModelAccuracyPanel
        accuracyRecords={accuracyRecords}
        terrainType="global"
      />
    </div>
  )
})

export default EnsembleSection
