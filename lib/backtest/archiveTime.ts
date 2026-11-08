/** UTC instant for verification storage. Bare stamps are accepted only from
 * endpoints explicitly requested with timezone=GMT. Never use browser TZ. */
export function archiveTime(value: string | number): string {
  const instant = typeof value === 'number' ? value * 1000 : Date.parse(
    /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}Z`,
  )
  if (!Number.isFinite(instant)) throw new Error(`Invalid archive timestamp: ${value}`)
  return new Date(instant).toISOString()
}

export function shiftArchiveHours(stamp: string, hours: number): string {
  return new Date(Date.parse(archiveTime(stamp)) + hours * 3600_000).toISOString()
}
