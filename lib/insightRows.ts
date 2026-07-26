/**
 * Pure helpers for the InsightsTable row builder. Extracted from
 * `components/InsightsTable.tsx` in S6 so the row-construction logic
 * becomes unit-testable without the React renderer.
 *
 * The module currently exports two helpers:
 *
 *   - `boundsForBucket(times, startIndex, bucket, limit)`: emits the
 *     `[startIdx, endIdx]` index pairs that the InsightsTable renders
 *     as rows. Returns hour-aligned ranges when `bucket` divides 24h
 *     evenly (1, 2, 3, 4, 6, 12) and day-aligned ranges otherwise.
 *
 *   - `aggregateOverRange(values, weights)`: computes the simple mean
 *     of a per-hour ensemble stream inside a `[start, end]` slice,
 *     skipping nulls. Documented and pinned by a unit test in
 *     `sprint6.insightsBucket.test.ts`.
 */

export interface InsightBucket {
  /** First hour index (inclusive) into the trimmed time series. */
  startIdx: number
  /** Last hour index (inclusive). */
  endIdx: number
}

const HOUR_MS = 60 * 60 * 1000

function dayKeyFromUtc(date: Date): string {
  return `${date.getUTCFullYear()}-${date.getUTCMonth()}-${date.getUTCDate()}`
}

/**
 * Produce the per-bucket index ranges that drive the InsightsTable rows.
 *
 * @param times       - The trimmed ("view") time series.
 * @param fullTimes   - The untrimmed time series. Only consulted when
 *                       `bucket === 24` so the first row can scan
 *                       backwards to 00:00 local.
 * @param startIndex  - The hour that "now" corresponds to.
 * @param bucket      - Aggregation width in hours.
 * @param limit       - Hard cap on the number of rows the consumer is
 *                       willing to render (Sprint 10 mobile pagination).
 */
export function boundsForBucket(
  times: Date[],
  fullTimes: Date[] | undefined,
  startIndex: number,
  bucket: number,
  limit: number,
  weekDays?: 7 | 14,
): InsightBucket[] {
  if (times.length === 0) return []
  const tt = bucket === 24 && fullTimes?.length ? fullTimes : times
  const days = weekDays ?? 7
  if (bucket === 24) {
    const rem = startIndex % 24
    const toMidnight = rem === 0 ? 24 : 24 - rem
    const end = Math.min(tt.length, startIndex + toMidnight + (days - 1) * 24)
    const out: InsightBucket[] = []
    let current: InsightBucket | null = null
    let currentKey = ''
    for (let i = startIndex; i < end; i++) {
      const t = tt[i]
      const key = t instanceof Date ? dayKeyFromUtc(t) : ''
      if (!current || key !== currentKey) {
        let dayStart = i
        while (dayStart > 0) {
          const prev = tt[dayStart - 1]
          if (!(prev instanceof Date)) break
          if (dayKeyFromUtc(prev) !== key) break
          dayStart--
        }
        current = { startIdx: dayStart, endIdx: i }
        currentKey = key
        out.push(current)
      } else {
        current.endIdx = i
      }
    }
    return out
  }
  // Hour-aligned buckets. We start at the first hour of the trimmed
  // series that the caller asked us to render (`limit` hours, anchored
  // to `startIndex`).
  const out: InsightBucket[] = []
  let cursor = 0
  const max = Math.min(times.length, limit)
  while (cursor < max) {
    const startT = times[cursor]
    if (!(startT instanceof Date)) break
    const startHour = startT.getUTCHours()
    const alignedStart = startHour - (startHour % bucket)
    const startInBucket = startHour - alignedStart
    const remaining = bucket - startInBucket
    const end = Math.min(cursor + remaining, max) - 1
    if (end < cursor) break
    out.push({ startIdx: cursor, endIdx: end })
    cursor = end + 1
  }
  return out
}

/**
 * Compute the simple mean of a per-hour ensemble stream inside a
 * `[start, end]` index range, skipping `null`/`undefined` cells.
 * Used by the bucket aggregation code in `InsightsTable.tsx`.
 */
export function aggregateOverRange(
  values: ReadonlyArray<number | null | undefined>,
  start: number,
  end: number,
): number | null {
  let sum = 0
  let count = 0
  for (let i = start; i <= end; i++) {
    const v = values[i]
    if (typeof v === 'number' && Number.isFinite(v)) {
      sum += v
      count += 1
    }
  }
  return count > 0 ? sum / count : null
}

/**
 * Find the longest aligned run of hours (length `bucket`) inside the
 * trimmed time series. Used by InsightsTable to decide where a
 * partial bucket at the start/end of the data set is allowed. The
 * hour-aligned buckets align on the wall-clock hour (`0`, `12`,
 * etc.) so the rendered cells don't appear to drift across DST.
 */
export function alignToHourBoundary(times: Date[], cursor: number, bucket: number): number {
  if (cursor >= times.length) return cursor
  const t = times[cursor]
  if (!(t instanceof Date)) return cursor
  const h = t.getUTCHours()
  return h - (h % bucket)
}

/**
 * `hourIndex` (the consumer's view-relative index into the trimmed
 * series) translated to an absolute hour index. The central ensemble
 * uses absolute lead time, so callers inside the bucket builder must
 * offset the row's `hourIndex` by `startIndex` before passing it on.
 */
export function absoluteLead(hourIndex: number, startIndex: number, bucket: number): number {
  return Math.max(0, hourIndex) + Math.max(1, bucket) - 1 + startIndex
}

/** Exposed for unit tests; mirrors `Date#getTime()` rounded to the
 *  nearest hour. Centralising it avoids subtle off-by-3600s bugs in
 *  tests that build synthetic fixture data. */
export function hourEpochMs(t: Date): number {
  return Math.floor(t.getTime() / HOUR_MS) * HOUR_MS
}
