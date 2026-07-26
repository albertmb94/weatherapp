'use client'

import { useCallback, useRef, useState } from 'react'

/**
 * Manage drag-state for column reordering in the Insights table.
 *
 * Why a hook: the original component had three separate pieces
 * (`dragIdx`, `overIdx`, `dragNodeRef`) wired by hand into three
 * different `onDrag*` callbacks. That made it easy to forget to
 * reset state on drop, which caused the "ghost column" ghost
 * effect when the user dropped back onto the source. Centralising
 * the state machine here keeps every consumer honest.
 *
 * Usage:
 *   const drag = useDragReorder()
 *   <td
 *     draggable
 *     onDragStart={e => drag.handleStart(e, idx)}
 *     onDragOver={e => drag.handleOver(e, idx)}
 *     onDrop={e => drag.handleDrop(e, idx, setOrder)}
 *     onDragEnd={drag.handleEnd}
 *   />
 */
export function useDragReorder(): {
  dragIdx: number | null
  overIdx: number | null
  handleStart: (e: React.DragEvent, idx: number) => void
  handleOver: (e: React.DragEvent, idx: number) => void
  handleDrop: (
    e: React.DragEvent,
    dropIdx: number,
    commit: (from: number, to: number) => void,
  ) => void
  handleEnd: () => void
} {
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [overIdx, setOverIdx] = useState<number | null>(null)
  const dragNodeRef = useRef<HTMLTableCellElement | null>(null)

  const handleStart = useCallback((e: React.DragEvent, idx: number) => {
    setDragIdx(idx)
    dragNodeRef.current = e.currentTarget as HTMLTableCellElement
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', '')
  }, [])

  const handleOver = useCallback((e: React.DragEvent, idx: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setOverIdx(idx)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent, dropIdx: number, commit: (from: number, to: number) => void) => {
      e.preventDefault()
      if (dragIdx === null || dragIdx === dropIdx) {
        setDragIdx(null)
        setOverIdx(null)
        return
      }
      commit(dragIdx, dropIdx)
      setDragIdx(null)
      setOverIdx(null)
    },
    [dragIdx],
  )

  const handleEnd = useCallback(() => {
    setDragIdx(null)
    setOverIdx(null)
  }, [])

  return { dragIdx, overIdx, handleStart, handleOver, handleDrop, handleEnd }
}
