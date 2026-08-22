'use client'

import { useState } from 'react'
import { useLocale } from '@/lib/LocaleContext'
import { STRINGS } from '@/lib/i18n'
import { formatAge } from '@/lib/formatAge'
import { useClientNow } from '@/lib/hooks/useClientNow'
import type { CurrentSnapshot } from '@/lib/friendlyForecast'
import { classifyEuropeanAqi, type AirQualityBand } from '@/lib/airQuality'
import { REFRESH_WINDOW_MS } from '@/lib/refreshWindow'

interface AirConditionsGridProps {
  snapshot: CurrentSnapshot | null
  title?: string
  /** When true, the UV card shows the dedicated live label, otherwise it
   *  renders as a forecast-for-the-selected-hour. */
  isLiveNow?: boolean
  /** Value of the provider's `current=uv_index`. */
  liveUv?: number | null
  /** Timestamp for the live UV reading (ISO string from provider). */
  liveUvValidAt?: Date | null
  /** Forecast fetched-at timestamp (ms) for the auto-refresh banner. */
  fetchedAt?: number | null
  /** Forecast age (ms) — shown next to the metrics header. */
  forecastAgeMs?: number | null
  /** Daily accumulated precipitation (mm/day) aligned with the trimmed
   *  hourly series by index 0. Used to surface the "Total hoy" tile in
   *  the third rain toggle position. Provided by `home-content` so the
   *  grid component stays free of fetch logic. */
  dailyPrecipitationSum?: (number | null)[] | null
  /** F5 (revised): the EU AQI value for the current hour.
   *  When non-null, the air-quality card renders alongside
   *  the existing tiles on every viewport. `null`/missing
   *  hides the card entirely. The provider returns up to
   *  ~120 h of AQI data so a single number from
   *  `series.european_aqi[nowIndex]` is enough. */
  europeanAqi?: number | null
  /** F5 (revised, second pass): the current grass pollen
   *  reading (grains/m³). Surfaces as a 6th tile in the
   *  Métricas block. The tile toggles between grass and
   *  birch on tap. `null`/missing hides the tile. */
  grassPollen?: number | null
  /** F5 (revised, second pass): the current birch pollen
   *  reading (grains/m³). The tile shows whichever value
   *  matches the active mode (grass or birch). */
  birchPollen?: number | null
}

function fmtTemp(value: number | null): string {
  return value === null ? '–' : `${Math.round(value)}°`
}

function fmtWind(value: number | null): string {
  if (value === null) return '–'
  return `${Math.round(value)}`
}

function fmtPercent(value: number | null): string {
  return value === null ? '–' : `${Math.round(value)}%`
}

function fmtMm(value: number | null): string {
  if (value === null) return '–'
  return `${value.toFixed(1)}`
}

function RealFeelIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-4 h-4">
      <path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4 4 0 1 0 5 0z" />
    </svg>
  )
}

function WindIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-4 h-4">
      <path d="M3 8h11a3 3 0 1 0-3-3" />
      <path d="M3 14h15a3 3 0 1 1-3 3" />
    </svg>
  )
}

function DropIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <path d="M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z" />
    </svg>
  )
}

function AirIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <path d="M4 9h11a3 3 0 1 0-3-3" />
      <path d="M3 14h15a3 3 0 1 1-3 3" />
      <path d="M3 19h7" />
    </svg>
  )
}

function PollenIcon() {
  return (
    // A simple flower with petals — chosen over a grain-of-pollen
    // glyph so the icon is recognisable at 16 px without the user
    // having to hover. The light fill + dark stroke also makes it
    // readable on the surface-raised background.
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
      <ellipse cx="12" cy="5" rx="2" ry="3" />
      <ellipse cx="12" cy="19" rx="2" ry="3" />
      <ellipse cx="5" cy="12" rx="3" ry="2" />
      <ellipse cx="19" cy="12" rx="3" ry="2" />
    </svg>
  )
}

function UvIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-4 h-4">
      <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4" />
    </svg>
  )
}

function ToggleCard({
  label,
  value,
  unit,
  sub,
  icon,
  accent,
  onClick,
  extraTitle,
}: {
  label: string
  value: string
  unit?: string
  sub?: string
  icon: React.ReactNode
  accent: 'amber' | 'sky' | 'rose' | 'emerald'
  onClick: () => void
  extraTitle?: string
}) {
  const accentMap: Record<string, string> = {
    amber: 'text-amber-300 bg-amber-500/10',
    sky: 'text-sky-300 bg-sky-500/10',
    rose: 'text-rose-300 bg-rose-500/10',
    emerald: 'text-emerald-300 bg-emerald-500/10',
  }
  return (
    <button
      type="button"
      onClick={onClick}
      title={extraTitle}
      className="rounded-2xl border border-border bg-surface-raised p-3 md:p-4 flex flex-col gap-1 min-w-0 text-left cursor-pointer transition-colors hover:border-border-strong focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
    >
      <div className="flex items-center gap-1.5 text-text-tertiary">
        <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full ${accentMap[accent]}`}>{icon}</span>
        <span className="text-[11px] font-medium uppercase tracking-wide truncate">{label}</span>
      </div>
      <div className="flex items-baseline gap-1 mt-1">
        <span className="text-2xl md:text-3xl font-semibold text-text-primary tabular-nums leading-none">
          {value}
        </span>
        {unit ? (
          <span className="text-xs text-text-tertiary tabular-nums">{unit}</span>
        ) : null}
      </div>
      {sub ? (
        <span className="text-[10px] text-text-muted tabular-nums">{sub}</span>
      ) : null}
    </button>
  )
}

export default function AirConditionsGrid({
  snapshot,
  title,
  isLiveNow = true,
  liveUv = null,
  liveUvValidAt = null,
  fetchedAt = null,
  forecastAgeMs = null,
  dailyPrecipitationSum = null,
  europeanAqi = null,
  grassPollen = null,
  birchPollen = null,
}: AirConditionsGridProps) {
  const { locale } = useLocale()
  const s = STRINGS[locale]
  const heading = title ?? s.metricsTitle

  const [uvMode, setUvMode] = useState<'live' | 'peak'>('live')
  const [feelMode, setFeelMode] = useState<'feel' | 'high'>('feel')
  const [windMode, setWindMode] = useState<'wind' | 'gusts'>('wind')
  const [rainMode, setRainMode] = useState<'chance' | 'intensity' | 'day'>('chance')
  // F5 (revised, second pass): pollen toggle. We surface the
  // two most common allergens (grass and birch); the rest of
  // the AIR_METRICS list is hidden in this UI but stays
  // available for the (now-removed) full air-quality card and
  // for future expansion.
  const [pollenMode, setPollenMode] = useState<'grass' | 'birch'>('grass')

  // UV: in live mode prefer the provider's current=uv_index reading if we
  // still have it cached AND the user is on the actual current hour.
  // Outside of "live now" we fall back to the ensemble value because the
  // provider's current field is by definition "the present".
  const uvVal = uvMode === 'live'
    ? (isLiveNow ? (liveUv ?? snapshot?.uvIndex ?? null) : (snapshot?.uvIndex ?? null))
    : (snapshot?.uvIndexPeak ?? null)
  const uvDisplay = uvVal !== null ? uvVal.toFixed(1) : '–'
  const uvLabel = uvMode === 'live' ? s.uvModeLive : s.uvModePeak
  const uvUnit = uvMode === 'peak' ? s.uvPeak : ''
  // Age of the live UV reading. Open-Meteo reports ~15 min intervals.
  // B-NEW-20 (2026-07-27): we MUST NOT call `Date.now()` in the
  // `useState` initializer. That captures the server's clock
  // on SSR and the client's clock on hydration; even if the
  // tick interval re-syncs them every 60s, the *initial* value
  // differs by however many seconds elapsed between the server
  // render and the client hydration, which renders as a
  // different `uvTitle` (the `formatAge(uvAgeMs, locale)`
  // string) and triggers React #418. We start the state at
  // `null` (matches the SSR render and the first client
  // render) and set the actual `nowMs` in the same `useEffect`
  // that starts the tick interval — that runs only on the
  // client AFTER hydration.
  const nowMs = useClientNow(60_000) ?? 0
  const uvAgeMs = liveUvValidAt instanceof Date
    && !Number.isNaN(liveUvValidAt.getTime())
    ? Math.max(0, nowMs - liveUvValidAt.getTime())
    : null
  const uvTitle = uvAgeMs !== null
    ? `${locale === 'en' ? 'Live UV, updated ' : 'UV en vivo, actualizado hace '}${formatAge(uvAgeMs, locale)}`
    : undefined
  const isStale = forecastAgeMs !== null && forecastAgeMs > REFRESH_WINDOW_MS

  // Sensación / Máx
  const feelVal = feelMode === 'feel'
    ? (snapshot?.feelsLikeC ?? null)
    : (snapshot?.dailyHighC ?? null)
  const feelDisplay = fmtTemp(feelVal)
  const feelLabel = feelMode === 'feel' ? s.realFeel : s.dailyHigh

  // Viento / Rachas
  const windVal = windMode === 'wind'
    ? (snapshot?.windKmh ?? null)
    : (snapshot?.windGustsKmh ?? null)
  const windDisplay = fmtWind(windVal)
  const windLabel = windMode === 'wind' ? s.windSpeed : s.windGusts

  // Probabilidad calibrada / Intensidad / Total hoy
  // We try the calibrated probability first; if every model returned
  // null for that hour the helper falls back to the intensity heuristic,
  // so the cell never goes blank.
  const dailySum: number | null = (() => {
    if (!dailyPrecipitationSum || dailyPrecipitationSum.length === 0) return null
    const first = dailyPrecipitationSum[0]
    return typeof first === 'number' ? first : null
  })()
  const rainVal = rainMode === 'chance'
    ? (snapshot?.chanceOfRainPct ?? null)
    : rainMode === 'intensity'
      ? (snapshot?.precipitationMm ?? null)
      : dailySum
  const rainDisplay = rainMode === 'chance'
    ? fmtPercent(rainVal)
    : fmtMm(rainVal)
  const rainUnit = rainMode === 'chance' ? '' : 'mm'
  const rainLabel = rainMode === 'chance'
    ? s.chanceOfRain
    : rainMode === 'intensity'
      ? (s as { rainIntensity?: string }).rainIntensity ?? s.precipTotal
      : s.rainTotalDay

  return (
    <section aria-label={heading} className="rounded-2xl border border-border bg-surface-raised p-4 md:p-5">
      <div className="flex items-center justify-between mb-3 gap-2">
        <h3 className="text-[11px] uppercase tracking-widest text-text-tertiary font-semibold">
          {heading}
        </h3>
        {forecastAgeMs !== null ? (
          <span
            className={`text-[10px] tabular-nums ${isStale ? 'text-amber-400' : 'text-text-tertiary'}`}
            title={fetchedAt ? new Date(fetchedAt).toLocaleString() : ''}
            role={isStale ? 'status' : undefined}
            aria-live={isStale ? 'polite' : undefined}
          >
            {isStale
              ? (locale === 'en' ? `Refresh due · ${formatAge(forecastAgeMs, locale)}` : `Recarga pendiente · ${formatAge(forecastAgeMs, locale)}`)
              : (locale === 'en' ? `Updated ${formatAge(forecastAgeMs, locale)} ago` : `Actualizado hace ${formatAge(forecastAgeMs, locale)}`)}
          </span>
        ) : null}
      </div>
      {/* F5 (third pass): `grid-auto-rows: 1fr` forces every
          row to the same height so the second row of tiles
          (UV, EU AQI, Pollen) doesn't visually stick out
          from the first row (feel, wind, rain) just because
          the cards have a slightly different intrinsic
          content height. `min-w-0` on the grid itself
          prevents a single oversized card from stretching
          its siblings past the column width. */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2 md:gap-3 [grid-auto-rows:1fr] min-w-0">
        <ToggleCard
          label={feelLabel}
          value={feelDisplay}
          icon={<RealFeelIcon />}
          accent="amber"
          onClick={() => setFeelMode(m => m === 'feel' ? 'high' : 'feel')}
        />
        <ToggleCard
          label={windLabel}
          value={windDisplay}
          unit="km/h"
          icon={<WindIcon />}
          accent="sky"
          onClick={() => setWindMode(m => m === 'wind' ? 'gusts' : 'wind')}
        />
        <ToggleCard
          label={rainLabel}
          value={rainDisplay}
          unit={rainUnit}
          icon={<DropIcon />}
          accent="rose"
          onClick={() => setRainMode(m => m === 'chance' ? 'intensity' : m === 'intensity' ? 'day' : 'chance')}
          // B-NBT-9b: the "Total hoy" figure is the provider's daily
          // aggregate (weighted across models), NOT the hourly-ensemble
          // sum the daily chips show — surface the source so the two
          // numbers don't look like a bug when they differ slightly.
          extraTitle={rainMode === 'day'
            ? (locale === 'en'
              ? 'Provider daily total, weighted across models — may differ slightly from the hourly ensemble sum in the daily chips'
              : 'Total diario del proveedor, ponderado entre modelos — puede diferir ligeramente de la suma horaria del ensemble de los chips diarios')
            : undefined}
        />
        <ToggleCard
          // The mode label (Live/Peak) already tells the user which
          // view they're seeing, so the redundant "en vivo" badge was
          // producing "Índice UV · En vivo · en vivo". Live freshness is
          // still surfaced via the tooltip (`extraTitle`).
          label={`${s.uvIndex} · ${uvLabel}`}
          value={uvDisplay}
          unit={uvUnit}
          icon={<UvIcon />}
          accent="emerald"
          onClick={() => setUvMode(m => m === 'live' ? 'peak' : 'live')}
          extraTitle={uvTitle}
        />
        {/* F5 (revised): the EU AQI value lands as a 5th tile
            on every viewport (mobile included). The value is
            the headline number (text-text-primary) and the
            sub-line carries the band label with a band-
            specific colour so the user can read it at a
            glance without needing to compare against a
            separate chip. The previous build rendered the
            band as a green-on-green pill which the user
            reported was unreadable. */}
        {europeanAqi !== null && europeanAqi !== undefined ? (
          <AirQualityTile
            label={s.airQualityMetricLabel}
            value={europeanAqi}
            classification={classifyEuropeanAqi(europeanAqi)}
            locale={locale}
          />
        ) : null}
        {/* F5 (revised, second pass): pollen tile. Toggles
            between grass and birch on tap; whichever value
            is null falls back to the other. We don't render
            the tile when both readings are null. */}
        {(grassPollen !== null && grassPollen !== undefined) ||
        (birchPollen !== null && birchPollen !== undefined) ? (
          <PollenTile
            grassPollen={grassPollen ?? null}
            birchPollen={birchPollen ?? null}
            mode={pollenMode}
            onCycle={() => setPollenMode(m => (m === 'grass' ? 'birch' : 'grass'))}
            locale={locale}
          />
        ) : null}
      </div>
    </section>
  )
}

/**
 * F5 (revised): the air-quality tile that lives inside the
 * Métricas grid. It uses the same `ToggleCard` visual
 * language (rounded card, big number, sub-line) so the
 * section reads as one block. The band label is coloured
 * according to the EU AQI band but the *background* is the
 * standard surface-raised colour — so the user can always
 * read the label regardless of the band. The previous
 * build used a green-on-green pill which lost all contrast
 * in the "good" / "fair" bands.
 */
const BAND_SUB_TEXT: Record<AirQualityBand, string> = {
  good: 'text-emerald-300',
  fair: 'text-lime-300',
  moderate: 'text-amber-300',
  poor: 'text-orange-300',
  very_poor: 'text-rose-300',
  extreme: 'text-red-200',
}

function AirQualityTile({
  label,
  value,
  classification,
  locale,
}: {
  label: string
  value: number
  classification: ReturnType<typeof classifyEuropeanAqi>
  locale: 'en' | 'es'
}) {
  const bandText = classification ? BAND_SUB_TEXT[classification.band] : 'text-text-tertiary'
  const bandLabel = classification?.label ?? '—'
  const hint = classification?.hint
  // F5 (third pass): the band label used to sit on its own
  // sub-line below the number. The user reported two issues:
  //   1. The sub-line made this card ~30% taller than the
  //      first-row cards (feel / wind / rain / UV), so the
  //      second row of the grid visibly stuck out.
  //   2. The label "Moderada" felt disconnected from the
  //      number — they should read as one piece.
  // We now render the band label inline with the value:
  // `40 AQI · Moderada` on a single line. The text colour
  // keeps the band-specific hue so the user can still tell
  // the air quality at a glance.
  return (
    <div
      className="rounded-2xl border border-border bg-surface-raised p-3 md:p-4 flex flex-col gap-1 min-w-0 text-left"
      title={hint}
    >
      <div className="flex items-center gap-1.5 text-text-tertiary">
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full text-emerald-300 bg-emerald-500/10">
          <AirIcon />
        </span>
        <span className="text-[11px] font-medium uppercase tracking-wide truncate">{label}</span>
      </div>
      <div className="flex items-baseline gap-1 mt-1 flex-wrap">
        <span className="text-2xl md:text-3xl font-semibold text-text-primary tabular-nums leading-none">
          {Math.round(value)}
        </span>
        <span className="text-xs text-text-tertiary tabular-nums">
          {locale === 'en' ? 'EU AQI' : 'AQI'}
        </span>
        {/* Inline band label — same row as the value so the
            tile keeps the 2-line height the other tiles
            have. The `·` separator gives a clear visual
            break between the unit and the band. */}
        <span
          className={`text-[11px] font-medium tabular-nums ${bandText}`}
        >
          · {bandLabel}
        </span>
      </div>
    </div>
  )
}

/**
 * F5 (revised, second pass): pollen tile. Cycles between
 * grass and birch on tap. The two readings come from the
 * parent as separate props so the component is a pure
 * view — the state lives in the parent.
 *
 * The active mode label is rendered in the same `sub` slot
 * the other tiles use (e.g. "Live", "Peak"), so the
 * Métricas block stays visually consistent.
 */
const POLLEN_LABEL: Record<'grass' | 'birch', { es: string; en: string }> = {
  grass: { es: 'Gramíneas', en: 'Grass' },
  birch: { es: 'Abedul', en: 'Birch' },
}

function PollenTile({
  grassPollen,
  birchPollen,
  mode,
  onCycle,
  locale,
}: {
  grassPollen: number | null
  birchPollen: number | null
  mode: 'grass' | 'birch'
  onCycle: () => void
  locale: 'en' | 'es'
}) {
  // If the active reading is null but the other one is
  // present, the tile still renders (the user just sees an
  // em-dash) — better than an invisible slot mid-grid.
  const activeValue = mode === 'grass' ? grassPollen : birchPollen
  const fallbackValue = mode === 'grass' ? birchPollen : grassPollen
  const value = activeValue ?? fallbackValue
  const modeLabel = POLLEN_LABEL[mode][locale]
  const display = value === null || value === undefined ? '–' : Math.round(value).toString()
  const fallbackNote = activeValue === null && fallbackValue !== null
    ? (locale === 'en' ? `fallback to ${mode === 'grass' ? 'birch' : 'grass'}` : `usando ${mode === 'grass' ? 'abedul' : 'gramíneas'}`)
    : undefined
  return (
    <button
      type="button"
      onClick={onCycle}
      title={
        fallbackNote
          ? (locale === 'en'
              ? `Tap to switch · ${fallbackNote}`
              : `Toca para cambiar · ${fallbackNote}`)
          : (locale === 'en' ? 'Tap to switch between grass and birch pollen' : 'Toca para alternar entre gramíneas y abedul')
      }
      className="rounded-2xl border border-border bg-surface-raised p-3 md:p-4 flex flex-col gap-1 min-w-0 text-left cursor-pointer transition-colors hover:border-border-strong focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
    >
      {/* F5 (third pass): the active mode label (Gramíneas /
          Abedul) used to live on its own sub-line below the
          value, which made this card taller than the other
          tiles in the grid. The user asked for the mode
          indicator to sit on the same row as the header
          ("Polen · Gramíneas") so the card keeps the
          2-line height the other tiles have. */}
      <div className="flex items-center gap-1.5 text-text-tertiary min-w-0">
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full text-emerald-300 bg-emerald-500/10 shrink-0">
          <PollenIcon />
        </span>
        <span className="text-[11px] font-medium uppercase tracking-wide truncate">
          {locale === 'en' ? 'Pollen' : 'Polen'}
        </span>
        <span className="text-[11px] font-medium tabular-nums text-text-secondary ml-auto shrink-0">
          · {modeLabel}
        </span>
      </div>
      <div className="flex items-baseline gap-1 mt-1">
        <span className="text-2xl md:text-3xl font-semibold text-text-primary tabular-nums leading-none">
          {display}
        </span>
        <span className="text-xs text-text-tertiary tabular-nums">
          {locale === 'en' ? 'gr/m³' : 'gr/m³'}
        </span>
      </div>
    </button>
  )
}
