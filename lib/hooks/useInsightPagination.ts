'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/** Page size for the bucket=1 / bucket=2 / bucket=6 Insights table. */
export const INSIGHTS_PAGE_SIZE = 48

/**
 * Mobile-friendly pager for the Insights table.
 *
 * Why a hook: the original component kept the page index, the
 * "previous bucket" ref and the scroll-to-top effect in the
 * component body, which made the JSX even messier than it already
 * was. Centralising the state machine here plus the helper
 * `slice(rows)` for the visible window keeps the table component
 * to "render rows" without dragging in any visibility math.
 *
 * The scroll-to-top itself was previously inlined here. It only
 * worked when the table had an internal scroll container (desktop
 * and landscape phone); on mobile portrait the page is the scroll
 * ancestor, so the table container is at `scrollTop = 0` already
 * and the call was a silent no-op. The hook now only manages the
 * page state — the component decides where to scroll the user
 * (container vs section) so the behaviour is consistent on every
 * viewport.
 */
export function useInsightPagination(
  rowCount: number,
  bucket: number,
): {
  page: number
  pageSize: number
  setPage: (page: number) => void
  visibleStart: number
  visibleEnd: number
  visibleRows: <T>(rows: T[]) => T[]
  hasNext: boolean
  hasPrev: boolean
  remaining: number
  onNextClick: () => void
  onPrevClick: () => void
} {
  const [page, setPage] = useState(0)
  const prevBucketRef = useRef<number>(bucket)

  // Reset to page 0 whenever the bucket changes so the user always
  // starts at the top of the new window.
  useEffect(() => {
    if (prevBucketRef.current !== bucket) {
      setPage(0)
      prevBucketRef.current = bucket
    }
  }, [bucket])

  const safePage = Math.min(page, Math.max(0, Math.floor((rowCount - 1) / INSIGHTS_PAGE_SIZE)))
  const visibleStart = safePage * INSIGHTS_PAGE_SIZE
  const visibleEnd = Math.min(rowCount, visibleStart + INSIGHTS_PAGE_SIZE)
  const visibleRows = useCallback(
    <T,>(rows: T[]): T[] => rows.slice(visibleStart, visibleEnd),
    [visibleStart, visibleEnd],
  )

  const onNextClick = useCallback(() => {
    if (visibleEnd >= rowCount) return
    setPage(p => p + 1)
  }, [rowCount, visibleEnd])

  const onPrevClick = useCallback(() => {
    setPage(p => Math.max(0, p - 1))
  }, [])

  return {
    page,
    pageSize: INSIGHTS_PAGE_SIZE,
    setPage,
    visibleStart,
    visibleEnd,
    visibleRows,
    hasNext: visibleEnd < rowCount,
    hasPrev: safePage > 0,
    remaining: rowCount - visibleEnd,
    onNextClick,
    onPrevClick,
  }
}
