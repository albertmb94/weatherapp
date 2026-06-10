import type { WeatherModel } from './models'
import { METRICS } from './models'

// Format a "UTC-fake-local" Date (see lib/dateUtils.ts) as a local ISO
// string without the trailing 'Z'. Open-Meteo returns `time` in the
// location's local timezone and we store it that way, so toISOString() would
// misleadingly tag it as UTC. The "Hour" column already disambiguates.
function fakeUtcToLocalIsoString(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:00`
}

export function exportForecastCsv(
  models: WeatherModel[],
  times: Date[],
  series: Record<string, Record<string, (number | null)[]>>,
  maxHours: number
): string {
  const nonAllMetrics = METRICS.filter(m => m.id !== 'all')
  const header = ['Hour', 'DateTime', ...models.flatMap(m => nonAllMetrics.map(met => `${m.label} ${met.label}`))]
  const rows: string[][] = []
  const limit = Math.min(times.length, maxHours)

  for (let i = 0; i < limit; i++) {
    const row: string[] = [
      String(i),
      fakeUtcToLocalIsoString(times[i]),
      ...models.flatMap(m => nonAllMetrics.map(met => {
        const v = series[m.id]?.[met.id]?.[i]
        return v !== null && v !== undefined ? String(v) : ''
      }))
    ]
    rows.push(row)
  }

  return [header.join(','), ...rows.map(r => r.join(','))].join('\n')
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
