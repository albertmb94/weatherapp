const HOUR_MS = 3600000

/** Open-Meteo precipitation is the amount in the hour ending at time. */
export function precipitationDayKey(end: Date): string {
  return new Date(end.getTime() - 1).toISOString().slice(0, 10)
}

/** A civil day contains the intervals ending at 01:00 through the next
 * 00:00. Partial days use only the intervals present in the forecast. */
export function sumPrecipitationForDay(
  times: readonly Date[],
  first: number,
  last: number,
  amountAt: (index: number) => number | null,
): number | null {
  const start = times[first]
  const end = times[last]
  if (!start || !end) return null
  const date = start.toISOString().slice(0, 10)
  const next = times[last + 1]
  const final = next && next.getTime() - end.getTime() === HOUR_MS &&
    next.toISOString().slice(0, 10) !== date ? last + 1 : last
  let amount: number | null = null
  for (let index = first; index <= final; index++) {
    const time = times[index]
    if (!time || precipitationDayKey(time) !== date) continue
    const value = amountAt(index)
    if (value !== null) amount = (amount ?? 0) + value
  }
  return amount
}
