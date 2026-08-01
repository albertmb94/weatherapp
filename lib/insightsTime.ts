import { floorHourLocation } from './dateUtils'

/**
 * Compute the `startIndex` for the **Insights table only**, anchored
 * to the *current* wall-clock hour rather than the forecast's
 * `fetchedAt` stamp.
 *
 * Why: the existing `startIndex` (used by DailySummary, the slider
 * and the auto-refresh) is anchored to `fetchedAt` so the same
 * cached response always resolves to the same row across devices.
 * That contract is correct for "now = the hour the forecast was
 * issued" but it means a forecast that was cached at 15:00 still
 * shows a 15:00 first row at 17:52 — the user explicitly asked for
 * the Insights table to start at the *current* hour (17:00 in that
 * example), regardless of when the response was originally fetched.
 *
 * The rest of the UI (DailySummary, the hour slider, the auto-refresh
 * age indicator) keeps the previous behaviour so the contract there
 * is preserved.
 *
 * Semantics:
 *   - The first row of the Insights table is the *current* local
 *     hour, inclusive. If `nowMs` is 17:52, the first row covers
 *     17:00 — never earlier.
 *   - `nowMs` is the wall-clock timestamp (typically `Date.now()`
 *     on the client). `utcOffsetSeconds` converts that into the
 *     location's local time so the location and the user don't
 *     diverge across timezones.
 *   - `data` is the same `ForecastResult` shape that
 *     `home-content.tsx` already slices; we only need the `time`
 *     and `utcOffsetSeconds` fields.
 *   - If `times` is empty we return 0; if every timestamp is in the
 *     past we return `times.length` (caller treats it as "no rows
 *     to render").
 */
export function computeInsightsStartIndex(
  times: ReadonlyArray<Date>,
  utcOffsetSeconds: number,
  nowMs: number,
): number {
  if (times.length === 0) return 0
  const localNow = new Date(nowMs + utcOffsetSeconds * 1000)
  const nowFloor = floorHourLocation(localNow)
  const nowTs = nowFloor.getTime()
  for (let i = 0; i < times.length; i++) {
    const t = times[i]
    if (t instanceof Date && t.getTime() >= nowTs) return i
  }
  return times.length
}
