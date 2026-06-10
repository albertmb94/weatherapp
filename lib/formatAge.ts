// B9: locale-aware age formatter. 'now' becomes 'ahora' in Spanish.
const NOW_BY_LOCALE = { en: 'now', es: 'ahora' } as const

export function formatAge(ageMs: number | null, locale: 'en' | 'es' = 'en'): string {
  if (ageMs == null) return ''
  const minutes = Math.floor(ageMs / 60000)
  if (minutes < 1) return NOW_BY_LOCALE[locale]
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}
