type Series = Record<string, Record<string, (number | null)[]>>
const LEAD_METADATA = '__forecast_lead'

/** The provider supplies valid times but no common model-run timestamp.
 * The response acquisition time is the stable reference we can observe. */
export function attachForecastLead(series: Series, time: readonly Date[], offsetSeconds: number, fetchedAt: number): void {
  const localReference = fetchedAt + offsetSeconds * 1000
  if (!Number.isFinite(localReference) || series[LEAD_METADATA]) return
  series[LEAD_METADATA] = {
    hours: time.map(t => t instanceof Date ? Math.max(0, (t.getTime() - localReference) / 3600000) : null),
  }
}

export function forecastLeadAtHour(series: Series, index: number, fallback: number): number {
  const lead = series[LEAD_METADATA]?.hours?.[index]
  return typeof lead === 'number' && Number.isFinite(lead) ? lead : Math.max(0, fallback)
}
