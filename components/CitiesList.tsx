'use client'

import { useLocale } from '@/lib/LocaleContext'
import { STRINGS } from '@/lib/i18n'
import { useSavedLocations } from '@/lib/hooks/useSavedLocations'

interface CitiesListProps {
  onSelect: (name: string, lat: number, lon: number) => void
  currentCityName: string
  currentCityId?: number
  onSaveCurrent: () => void
  saving: boolean
}

/**
 * Saved-cities panel for the Ciudades sidebar entry. Renders the user's
 * bookmarked locations with a "Save city" CTA so the current weather view
 * can be bookmarked without leaving the friendly layout. Data lives in
 * localStorage only.
 *
 * Extracted from `home-content.tsx` in S5 to thin out the orchestrator.
 * The saved-locations read/write path now goes through the shared
 * `useSavedLocations` hook introduced in S4.
 */
export default function CitiesList({
  onSelect,
  currentCityName,
  currentCityId,
  onSaveCurrent,
  saving,
}: CitiesListProps) {
  const { locale } = useLocale()
  const s = STRINGS[locale]
  const { saved, isLoading, remove } = useSavedLocations()
  const empty = saved.length === 0

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={onSaveCurrent}
        disabled={saving || currentCityId !== undefined}
        aria-label={s.citiesSaveCurrent}
        className={`w-full flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${
          currentCityId !== undefined
            ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
            : 'border-border bg-accent text-white hover:bg-accent-hover disabled:opacity-60'
        }`}
      >
        <span className="flex flex-col">
          <span className="text-sm font-semibold">{s.citiesSaveCurrent}</span>
          <span
            className={`text-xs truncate ${currentCityId !== undefined ? 'text-emerald-300/80' : 'text-white/80'}`}
          >
            {currentCityName}
          </span>
        </span>
        {saving ? (
          <span className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
        ) : currentCityId !== undefined ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
            <path d="M12 5v14M5 12h14" />
          </svg>
        )}
      </button>

      {isLoading ? (
        <p className="text-sm text-text-tertiary">{s.loadingStations}</p>
      ) : empty ? (
        <p className="text-sm text-text-tertiary">
          {s.citiesEmpty} {s.citiesEmptyHint}
        </p>
      ) : (
        <ul className="space-y-1">
          {saved.map(loc => (
            <li
              key={loc.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2"
            >
              <button
                type="button"
                onClick={() => onSelect(loc.name, loc.latitude, loc.longitude)}
                className="min-h-[36px] flex-1 text-left text-sm text-text-primary hover:text-accent transition-colors"
              >
                {loc.name}
                <span className="block text-xs text-text-tertiary tabular-nums">
                  {loc.latitude.toFixed(2)}, {loc.longitude.toFixed(2)}
                </span>
              </button>
              <button
                type="button"
                onClick={() => {
                  void remove(loc.id)
                }}
                className="min-h-[36px] min-w-[36px] flex items-center justify-center text-text-tertiary hover:text-red-400 transition-colors"
                aria-label={`Remove ${loc.name}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
