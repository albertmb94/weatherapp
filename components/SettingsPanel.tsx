'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useLocale } from '@/lib/LocaleContext'
import { useTheme } from '@/lib/ThemeContext'
import { STRINGS } from '@/lib/i18n'
import { exportForecastCsv, downloadCsv } from '@/lib/exportCsv'
import { formatAge } from '@/lib/formatAge'
import { useRefresh } from '@/lib/useRefresh'
import { saveLocalLocation } from '@/lib/localStorageLocations'
import type { WeatherModel, MetricId } from '@/lib/models'

interface SettingsPanelProps {
  marine: boolean
  onMarineToggle: () => void
  showBasic: boolean
  onBasicToggle: () => void
  cityName: string
  positionLat: number
  positionLon: number
  viewData: {
    time: Date[]
    series: Record<string, Record<string, (number | null)[]>>
    utcOffsetSeconds: number
  } | null
  displayModels: WeatherModel[]
  effectiveMaxHours: number
  selectedMetric: MetricId
}

interface ToggleRowProps {
  label: string
  description?: string
  active: boolean
  onClick: () => void
  accent?: 'sky' | 'cyan' | 'emerald' | 'amber'
}

function ToggleRow({ label, description, active, onClick, accent = 'sky' }: ToggleRowProps) {
  const accentMap: Record<NonNullable<ToggleRowProps['accent']>, string> = {
    sky: 'bg-sky-500',
    cyan: 'bg-cyan-500',
    emerald: 'bg-emerald-500',
    amber: 'bg-amber-500',
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border border-border bg-surface hover:bg-surface-popover transition-colors text-left"
    >
      <div className="min-w-0">
        <p className="text-sm text-text-primary font-medium">{label}</p>
        {description ? <p className="text-xs text-text-tertiary mt-0.5 truncate">{description}</p> : null}
      </div>
      <span
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
          active ? accentMap[accent] : 'bg-border'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
            active ? 'translate-x-[18px]' : 'translate-x-[2px]'
          }`}
        />
      </span>
    </button>
  )
}

export default function SettingsPanel(props: SettingsPanelProps) {
  const { locale, toggleLocale } = useLocale()
  const s = STRINGS[locale]
  const { theme, preference, cycleTheme } = useTheme()
  const queryClient = useQueryClient()
  const { refresh, isPending: isRefreshing, lastOutcome } = useRefresh()
  const [feedback, setFeedback] = useState<string | null>(null)

  const saveMutation = useMutation({
    // Saved cities are per-device (localStorage). The old implementation
    // posted to /api/locations, which now returns 410 Gone and so
    // surface-stored no result. Write directly and let the React Query
    // invalidation refresh the list component.
    mutationFn: async () => {
      try {
        saveLocalLocation(props.cityName, props.positionLat, props.positionLon)
        return { ok: true }
      } catch (err) {
        throw err
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['saved-locations'] })
      setFeedback(locale === 'en' ? `Saved ${props.cityName}` : `Guardado ${props.cityName}`)
      setTimeout(() => setFeedback(null), 2200)
    },
    onError: () => {
      setFeedback(locale === 'en' ? 'Could not save city' : 'No se pudo guardar la ciudad')
      setTimeout(() => setFeedback(null), 2200)
    },
  })

  const { data: refreshStatus } = useQuery<{ lastRefreshedAt: number | null; ageMs: number | null }>({
    queryKey: ['refresh-status'],
    queryFn: async () => {
      const res = await fetch('/api/refresh')
      if (!res.ok) throw new Error('refresh status')
      return res.json()
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
  })
  const refreshAge = formatAge(refreshStatus?.ageMs ?? null, locale)
  const otherLocale = locale === 'en' ? 'es' : 'en'

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-border bg-surface-raised p-4">
        <h3 className="text-[11px] uppercase tracking-widest text-text-tertiary font-semibold mb-3">
          {s.settingsTitle}
        </h3>
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface px-3 py-2.5">
            <div>
              <p className="text-sm text-text-primary font-medium">{s.settingsLanguage}</p>
              <p className="text-xs text-text-tertiary">{locale === 'en' ? 'English' : 'Español'}</p>
            </div>
            <button
              onClick={toggleLocale}
              className="rounded-md border border-border px-2.5 py-1 text-xs font-semibold text-text-primary hover:bg-surface-popover transition-colors"
              title={locale === 'en' ? 'Cambiar a español' : 'Switch to English'}
              aria-label={locale === 'en' ? 'Switch language' : 'Cambiar idioma'}
            >
              {otherLocale.toUpperCase()}
            </button>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface px-3 py-2.5">
            <div>
              <p className="text-sm text-text-primary font-medium">{s.settingsTheme}</p>
              <p className="text-xs text-text-tertiary">{preference} ({theme})</p>
            </div>
            <button
              onClick={cycleTheme}
              className="rounded-md border border-border px-2.5 py-1 text-xs font-semibold text-text-primary hover:bg-surface-popover transition-colors"
              aria-label="Toggle theme"
            >
              {theme === 'dark' ? '🌙' : '☀️'}
            </button>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-surface-raised p-4">
        <h3 className="text-[11px] uppercase tracking-widest text-text-tertiary font-semibold mb-3">
          {locale === 'en' ? 'Data sources' : 'Fuentes de datos'}
        </h3>
        <div className="space-y-2">
          <ToggleRow
            label={s.marine}
            description={locale === 'en' ? 'Open-Meteo marine API' : 'API marina Open-Meteo'}
            active={props.marine}
            onClick={props.onMarineToggle}
            accent="cyan"
          />
          {props.marine ? (
            <ToggleRow
              label={s.basic}
              description={locale === 'en' ? 'Show land metrics in marine mode' : 'Métricas terrestres en modo marino'}
              active={props.showBasic}
              onClick={props.onBasicToggle}
              accent="emerald"
            />
          ) : null}
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-surface-raised p-4">
        <h3 className="text-[11px] uppercase tracking-widest text-text-tertiary font-semibold mb-3">
          {locale === 'en' ? 'Actions' : 'Acciones'}
        </h3>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            className="min-h-[40px] rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary hover:bg-surface-popover disabled:opacity-50 transition-colors"
          >
            {s.save}
          </button>
          {props.viewData ? (
            <button
              onClick={() => {
                const csv = exportForecastCsv(props.displayModels, props.viewData!.time, props.viewData!.series, props.effectiveMaxHours, props.viewData!.utcOffsetSeconds)
                downloadCsv(`forecast-${props.cityName}-${new Date().toISOString().slice(0, 10)}.csv`, csv)
              }}
              className="min-h-[40px] rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary hover:bg-surface-popover transition-colors"
            >
              {s.csv}
            </button>
          ) : null}
          {typeof navigator !== 'undefined' && 'share' in navigator ? (
            <button
              onClick={() => {
                navigator.share({ title: `Weather ${props.cityName}`, url: window.location.href }).catch(() => {})
              }}
              className="min-h-[40px] rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary hover:bg-surface-popover transition-colors"
            >
              {s.share}
            </button>
          ) : null}
          <button
            onClick={async () => {
              try {
                const query = new URLSearchParams(window.location.search).toString()
                const res = await fetch('/api/shorten', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ params: query }),
                })
                if (!res.ok) throw new Error('shorten failed')
                const data = await res.json()
                const shortUrl = `${window.location.origin}/s/${data.id}`
                await navigator.clipboard?.writeText(shortUrl)
                setFeedback(locale === 'en' ? `Link copied: ${shortUrl}` : `Link copiado: ${shortUrl}`)
              } catch {
                await navigator.clipboard?.writeText(window.location.href)
                setFeedback(locale === 'en' ? 'Link copied' : 'Link copiado')
              } finally {
                setTimeout(() => setFeedback(null), 2200)
              }
            }}
            className="min-h-[40px] rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary hover:bg-surface-popover transition-colors"
          >
            {locale === 'en' ? 'Copy link' : 'Copiar link'}
          </button>
          <button
            onClick={refresh}
            disabled={isRefreshing}
            className="min-h-[40px] rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary hover:bg-surface-popover disabled:opacity-50 transition-colors col-span-2 flex items-center justify-center gap-2"
            title={refreshAge ? `Last refresh ${refreshAge}` : ''}
          >
            {isRefreshing ? (
              <span className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
            ) : null}
            {isRefreshing
              ? (locale === 'en' ? 'Refreshing…' : 'Actualizando…')
              : lastOutcome?.kind === 'refreshed'
                ? (locale === 'en' ? `Updated · ${refreshAge || ''}` : `Actualizado · ${refreshAge || ''}`)
                : `${locale === 'en' ? 'Refresh' : 'Actualizar'} · ${refreshAge || ''}`}
          </button>
        </div>
        {feedback ? (
          <p className="mt-2 text-xs text-text-secondary text-center" role="status">{feedback}</p>
        ) : null}
      </section>
    </div>
  )
}
