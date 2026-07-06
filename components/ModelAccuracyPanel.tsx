'use client'

import { useMemo } from 'react'
import { useLocale } from '@/lib/LocaleContext'
import { STRINGS } from '@/lib/i18n'
import { MODELS } from '@/lib/models'

interface AccuracyRecord {
  model_id: string
  mae: number | null
  rmse: number | null
  bias: number | null
  sample_count: number
}

interface ModelAccuracyPanelProps {
  accuracyRecords: AccuracyRecord[]
  terrainType?: string
}

export default function ModelAccuracyPanel({ accuracyRecords, terrainType }: ModelAccuracyPanelProps) {
  const { locale } = useLocale()
  const s = STRINGS[locale]

  const modelStats = useMemo(() => {
    if (accuracyRecords.length === 0) return []

    // Group by model_id and compute averages
    const byModel = new Map<string, AccuracyRecord[]>()
    for (const record of accuracyRecords) {
      const existing = byModel.get(record.model_id) ?? []
      existing.push(record)
      byModel.set(record.model_id, existing)
    }

    const stats: Array<{
      id: string
      label: string
      color: string
      type: string
      avgMae: number | null
      avgRmse: number | null
      avgBias: number | null
      sampleCount: number
    }> = []

    for (const [modelId, records] of byModel) {
      const model = MODELS.find(m => m.id === modelId)
      const validMae = records.filter(r => r.mae !== null)
      const validRmse = records.filter(r => r.rmse !== null)
      const validBias = records.filter(r => r.bias !== null)

      stats.push({
        id: modelId,
        label: model?.label ?? modelId,
        color: model?.color ?? '#666',
        type: model?.type ?? 'deterministic',
        avgMae: validMae.length > 0
          ? validMae.reduce((sum, r) => sum + r.mae!, 0) / validMae.length
          : null,
        avgRmse: validRmse.length > 0
          ? validRmse.reduce((sum, r) => sum + r.rmse!, 0) / validRmse.length
          : null,
        avgBias: validBias.length > 0
          ? validBias.reduce((sum, r) => sum + r.bias!, 0) / validBias.length
          : null,
        sampleCount: records.reduce((sum, r) => sum + r.sample_count, 0),
      })
    }

    // Sort by RMSE (best first)
    return stats.sort((a, b) => {
      if (a.avgRmse === null) return 1
      if (b.avgRmse === null) return -1
      return a.avgRmse - b.avgRmse
    })
  }, [accuracyRecords])

  if (modelStats.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-surface-raised p-4 text-center">
        <p className="text-xs text-text-tertiary">{s.noAccuracyData}</p>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-border bg-surface-raised p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[11px] uppercase tracking-widest text-text-tertiary font-semibold">
          {s.modelAccuracyTitle}
        </h3>
        {terrainType && (
          <span className="text-[10px] text-text-muted px-2 py-0.5 rounded-full bg-surface border border-border">
            {terrainType}
          </span>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-text-tertiary border-b border-border">
              <th className="text-left py-1.5 px-2 font-medium">{s.modelLabel}</th>
              <th className="text-right py-1.5 px-2 font-medium">{s.accuracyType}</th>
              <th className="text-right py-1.5 px-2 font-medium">{s.accuracyMAE}</th>
              <th className="text-right py-1.5 px-2 font-medium">{s.accuracyRMSE}</th>
              <th className="text-right py-1.5 px-2 font-medium">{s.accuracyBias}</th>
              <th className="text-right py-1.5 px-2 font-medium">{s.accuracySamples}</th>
            </tr>
          </thead>
          <tbody>
            {modelStats.map(stat => (
              <tr key={stat.id} className="border-b border-border/50 hover:bg-surface-hover/30">
                <td className="py-1.5 px-2">
                  <div className="flex items-center gap-2">
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: stat.color }}
                    />
                    <span className="text-text-primary truncate">{stat.label}</span>
                  </div>
                </td>
                <td className="py-1.5 px-2 text-right text-text-tertiary">
                  {stat.type === 'ai' ? 'AI' : stat.type === 'ensemble' ? 'ENS' : 'NWP'}
                </td>
                <td className="py-1.5 px-2 text-right tabular-nums text-text-primary">
                  {stat.avgMae !== null ? stat.avgMae.toFixed(1) : '–'}
                </td>
                <td className="py-1.5 px-2 text-right tabular-nums text-text-primary">
                  {stat.avgRmse !== null ? stat.avgRmse.toFixed(1) : '–'}
                </td>
                <td className="py-1.5 px-2 text-right tabular-nums">
                  <span className={
                    stat.avgBias !== null
                      ? stat.avgBias > 0 ? 'text-amber-400' : 'text-sky-400'
                      : 'text-text-tertiary'
                  }>
                    {stat.avgBias !== null ? (stat.avgBias > 0 ? '+' : '') + stat.avgBias.toFixed(1) : '–'}
                  </span>
                </td>
                <td className="py-1.5 px-2 text-right text-text-tertiary tabular-nums">
                  {stat.sampleCount}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 text-[10px] text-text-muted">
        {s.accuracyNote}
      </div>
    </div>
  )
}
