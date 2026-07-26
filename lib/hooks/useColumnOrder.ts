'use client'

import { useCallback, useState } from 'react'
import {
  DEFAULT_ORDER,
  loadColumnOrder,
  saveColumnOrder,
  type MetricCellId,
} from '@/lib/insightsTableMeta'

/**
 * Persist the column order for the Insights table in localStorage.
 *
 * Replaces the inline `useState(loadColumnOrder)` + manual
 * `setColumnOrder` + `saveColumnOrder` pair that lived in
 * `components/InsightsTable.tsx` before S11. The hook is
 * intentionally tiny — it owns the order array, the drag state
 * and the reorder action so the component stays focused on JSX.
 *
 * `reset()` puts the order back to `DEFAULT_ORDER` without
 * touching the source file, which means a "Reset columns" button
 * can be wired from anywhere in the component tree.
 */
export function useColumnOrder(): {
  order: MetricCellId[]
  setOrder: (next: MetricCellId[]) => void
  resetOrder: () => void
  /** When `true` the saved order differs from `DEFAULT_ORDER`. */
  isDefaultOrder: boolean
} {
  const [order, setOrderState] = useState<MetricCellId[]>(() => loadColumnOrder())

  const setOrder = useCallback((next: MetricCellId[]) => {
    setOrderState(next)
    saveColumnOrder(next)
  }, [])

  const resetOrder = useCallback(() => {
    setOrder(DEFAULT_ORDER)
    saveColumnOrder(DEFAULT_ORDER)
  }, [])

  const isDefaultOrder = order.length === DEFAULT_ORDER.length && order.every(
    (id, i) => id === DEFAULT_ORDER[i],
  )

  return { order, setOrder, resetOrder, isDefaultOrder }
}
