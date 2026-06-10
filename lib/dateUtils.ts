/**
 * Open-Meteo returns `time` strings in the *location's local timezone* (e.g.
 * "2026-06-09T12:00") when `timezone=auto`.  `new Date('2026-06-09T12:00')`
 * would be interpreted as the *browser's* local time, which is wrong when the
 * user is in a different timezone than the queried location.
 *
 * The trick we use: parse the string as UTC (`+ 'Z'`) so that the resulting
 * Date's timestamp *is* the location's local time expressed as a UTC
 * timestamp.  From then on, we always use `getUTC*` methods and
 * `toLocaleTimeString({ timeZone: 'UTC' })` to read the location's local
 * hour / day.
 *
 * `utcOffsetSeconds` is the real offset of the location vs UTC (e.g. 3600
 * for CET winter).  It is used only to compute the equivalent of "now" in the
 * location's timezone.
 */

export function parseOpenMeteoTime(iso: string): Date {
  // Open-Meteo returns strings without offset (e.g. "2026-01-01T00:00").
  // If the string already ends with Z or an offset, parse it directly.
  const safe = iso.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(iso) ? iso : iso + 'Z'
  return new Date(safe)
}

export function parseOpenMeteoTimes(times: string[]): Date[] {
  return times.map(parseOpenMeteoTime)
}

/**
 * Returns a Date object that represents *now* in the location's timezone.
 * The returned Date is also "UTC-fake-local" (like `parseOpenMeteoTime`), so
 * you must use `getUTC*` / `toLocaleTimeString({ timeZone: 'UTC' })` on it.
 */
export function getLocationNow(utcOffsetSeconds: number): Date {
  const now = new Date()
  return new Date(now.getTime() + utcOffsetSeconds * 1000)
}

/**
 * Format a "UTC-fake-local" Date as a time string in the location's local
 * timezone.
 */
export function formatLocationTime(
  date: Date,
  locale: 'en' | 'es',
  options?: Intl.DateTimeFormatOptions
): string {
  return date.toLocaleTimeString(locale === 'en' ? 'en-US' : 'es-ES', {
    timeZone: 'UTC',
    ...options,
  })
}

/**
 * Format a "UTC-fake-local" Date as a date string in the location's local
 * timezone.
 */
export function formatLocationDate(
  date: Date,
  locale: 'en' | 'es',
  options?: Intl.DateTimeFormatOptions
): string {
  return date.toLocaleDateString(locale === 'en' ? 'en-US' : 'es-ES', {
    timeZone: 'UTC',
    ...options,
  })
}

/**
 * Human-readable UTC offset (e.g. "UTC+1", "UTC-5").
 */
export function formatUtcOffset(utcOffsetSeconds: number): string {
  const h = Math.round(utcOffsetSeconds / 3600)
  if (h === 0) return 'UTC'
  return `UTC${h > 0 ? '+' : ''}${h}`
}

/**
 * Round a UTC-fake-local date down to the nearest hour.
 */
export function floorHourLocation(date: Date): Date {
  const d = new Date(date.getTime())
  d.setUTCMinutes(0, 0, 0)
  return d
}

/**
 * Compare two UTC-fake-local dates by timestamp.
 */
export function locationTimeGreaterOrEqual(a: Date, b: Date): boolean {
  return a.getTime() >= b.getTime()
}
