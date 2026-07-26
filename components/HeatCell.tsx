'use client'

import type { ReactNode } from 'react'
import type { CellResult } from '@/lib/insightCells'
import WeatherConditionIcon from './WeatherConditionIcon'
import type { WeatherIconId } from '@/lib/weatherIcon'

interface HeatCellProps {
  /** Render output of `cellData()`. */
  cell: CellResult
  /** When `true` the cell renders without the heatmap background. */
  transparent?: boolean
}

/**
 * Render one `<td>` based on the result of `cellData()`. The whole
 * 700-line `InsightsTable` mostly consisted of `<td>` calls
 * following the same shape; centralising the wrapping here keeps
 * the table terse and lets us tweak the heat style in one place.
 */
export default function HeatCell({ cell, transparent }: HeatCellProps) {
  if (cell.node === null) {
    return (
      <span className="inline-flex items-center justify-center">
        <WeatherConditionIcon icon={'sunny' as WeatherIconId} size="sm" />
      </span>
    )
  }
  const style = transparent ? undefined : cell.style
  return <span style={style}>{cell.node as ReactNode}</span>
}
