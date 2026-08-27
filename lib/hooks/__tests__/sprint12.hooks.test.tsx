/**
 * Regression tests for S11 useColumnOrder + useDragReorder hooks.
 */

import { describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useColumnOrder } from '../useColumnOrder'
import { useDragReorder } from '../useDragReorder'
import { DEFAULT_ORDER } from '@/lib/insightsTableMeta'

describe('useColumnOrder', () => {
  it('starts with the default order', () => {
    const { result } = renderHook(() => useColumnOrder())
    expect(result.current.order).toEqual(DEFAULT_ORDER)
    expect(result.current.isDefaultOrder).toBe(true)
  })

  it('moves an item and persists the new order', () => {
    const { result } = renderHook(() => useColumnOrder())
    act(() => {
      const next = [...result.current.order]
      const [moved] = next.splice(0, 1)
      next.splice(2, 0, moved)
      result.current.setOrder(next)
    })
    expect(result.current.isDefaultOrder).toBe(false)
    expect(result.current.order[2]).toBe(DEFAULT_ORDER[0])
  })

  it('resets to the default order', () => {
    const { result } = renderHook(() => useColumnOrder())
    act(() => {
      const next = [...result.current.order].reverse()
      result.current.setOrder(next)
    })
    expect(result.current.isDefaultOrder).toBe(false)
    act(() => {
      result.current.resetOrder()
    })
    expect(result.current.order).toEqual(DEFAULT_ORDER)
  })
})

describe('useDragReorder', () => {
  it('records drag/over indexes and clears on drop', () => {
    const { result } = renderHook(() => useDragReorder())
    act(() => {
      const event = {
        preventDefault: () => {},
        dataTransfer: { effectAllowed: '', dropEffect: '', setData: () => {} },
        currentTarget: { click: () => {} },
      } as unknown as React.DragEvent
      result.current.handleStart(event, 0)
      result.current.handleOver(event, 1)
    })
    expect(result.current.dragIdx).toBe(0)
    expect(result.current.overIdx).toBe(1)
    expect(result.current.dragIdx).toBe(0)
    let committed = false
    act(() => {
      const event = {
        preventDefault: () => {},
        dataTransfer: { effectAllowed: '', dropEffect: '', setData: () => {} },
        currentTarget: { click: () => {} },
      } as unknown as React.DragEvent
      result.current.handleDrop(event, 1, () => {
        committed = true
      })
    })
    expect(committed).toBe(true)
    expect(result.current.dragIdx).toBeNull()
    expect(result.current.overIdx).toBeNull()
  })

  it('refuses to commit a self-drop', () => {
    const { result } = renderHook(() => useDragReorder())
    act(() => {
      const event = {
        preventDefault: () => {},
        dataTransfer: { effectAllowed: '', dropEffect: '', setData: () => {} },
        currentTarget: { click: () => {} },
      } as unknown as React.DragEvent
      result.current.handleStart(event, 2)
      result.current.handleOver(event, 2)
    })
    let committed = false
    act(() => {
      const event = {
        preventDefault: () => {},
        dataTransfer: { effectAllowed: '', dropEffect: '', setData: () => {} },
        currentTarget: { click: () => {} },
      } as unknown as React.DragEvent
      result.current.handleDrop(event, 2, () => {
        committed = true
      })
    })
    expect(committed).toBe(false)
  })
})
