'use client'

import { useLocale } from '@/lib/LocaleContext'
import { STRINGS } from '@/lib/i18n'

export type SidebarSection = 'weather' | 'cities' | 'map' | 'stations' | 'settings'

export interface LayerState {
  showMap: boolean
  showRadar: boolean
  marine: boolean
  showBasic: boolean
}

interface DesktopSidebarProps {
  active: SidebarSection
  onSelect: (section: SidebarSection) => void
  layers: LayerState
  onLayerToggle: {
    map: () => void
    radar: () => void
    marine: () => void
    basic: () => void
  }
}

interface ItemDef {
  id: SidebarSection
  labelKey: 'navWeather' | 'navCities' | 'navMap' | 'navStations' | 'navSettings'
  icon: React.ReactNode
}

function WeatherIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4" />
    </svg>
  )
}

function CitiesIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <path d="M3 21h18" />
      <path d="M5 21V8l4-3 4 3v13" />
      <path d="M13 21V11l3-2 4 2v10" />
      <path d="M7 11h2M7 14h2M7 17h2M15 13h2M15 16h2" />
    </svg>
  )
}

function MapIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <path d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l5.553 2.776A1 1 0 0022 18.882V8.118a1 1 0 00-1.447-.894L15 10m0 7V10m0 0L9 7" />
    </svg>
  )
}

function StationsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2 2M16.4 16.4l2 2M5.6 18.4l2-2M16.4 7.6l2-2" />
      <circle cx="12" cy="12" r="3.5" />
    </svg>
  )
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3h.1a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5h.1a1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8v.1a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" />
    </svg>
  )
}

const ITEMS: ItemDef[] = [
  { id: 'weather', labelKey: 'navWeather', icon: <WeatherIcon /> },
  { id: 'cities', labelKey: 'navCities', icon: <CitiesIcon /> },
  { id: 'map', labelKey: 'navMap', icon: <MapIcon /> },
  { id: 'stations', labelKey: 'navStations', icon: <StationsIcon /> },
  { id: 'settings', labelKey: 'navSettings', icon: <SettingsIcon /> },
]

interface ToggleSpec {
  id: keyof LayerState
  labelKey: 'map' | 'radar' | 'marine' | 'basic'
  accent: string
  active: boolean
  onClick: () => void
}

export default function DesktopSidebar({ active, onSelect, layers, onLayerToggle }: DesktopSidebarProps) {
  const { locale } = useLocale()
  const s = STRINGS[locale]

  // The Mapa toggle was removed from the Capas panel: activating/deactivating
  // the map belongs to the Mapa menu entry, not a layers toggle. Radar is
  // only shown while the user is inside the Mapa section so it doesn't
  // clutter the panel otherwise. Basic still hides when Marine is off.
  const toggles: ToggleSpec[] = []
  if (active === 'map') {
    toggles.push({ id: 'showRadar', labelKey: 'radar', accent: 'bg-sky-500', active: layers.showRadar, onClick: onLayerToggle.radar })
  }
  toggles.push({ id: 'marine', labelKey: 'marine', accent: 'bg-cyan-500', active: layers.marine, onClick: onLayerToggle.marine })
  if (layers.marine) {
    toggles.push({ id: 'showBasic', labelKey: 'basic', accent: 'bg-emerald-500', active: layers.showBasic, onClick: onLayerToggle.basic })
  }

  return (
    <nav
      aria-label={s.navAria}
      className="hidden md:flex flex-col items-stretch py-4 gap-1 w-[200px] shrink-0 bg-surface/80 border-r border-border"
    >
      <div className="flex flex-col items-center gap-1 px-3 pb-3">
        <div className="mb-1 flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500 to-blue-600 text-white shadow-md shadow-sky-500/20">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
            <path d="M3 15a4 4 0 0 1 .4-7.96A5 5 0 0 1 13 6.5a3 3 0 0 1 0 6H6a3 3 0 0 1-3-3z" fill="white" fillOpacity="0.2" />
            <circle cx="9" cy="9" r="3" fill="white" />
          </svg>
        </div>
      </div>
      <ul className="flex flex-col gap-1 w-full px-2">
        {ITEMS.map(item => {
          const isActive = active === item.id
          return (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => onSelect(item.id)}
                aria-current={isActive ? 'page' : undefined}
                aria-label={s[item.labelKey]}
                title={s[item.labelKey]}
                className={`group flex w-full flex-row items-center gap-3 rounded-lg px-3 py-2.5 text-xs font-medium transition-all ${
                  isActive
                    ? 'bg-accent-soft text-accent shadow-sm'
                    : 'text-text-tertiary hover:bg-surface-popover hover:text-text-secondary'
                }`}
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                  {item.icon}
                </span>
                <span className="text-left">{s[item.labelKey]}</span>
              </button>
            </li>
          )
        })}
      </ul>

      <div className="mt-4 px-3 pt-3 border-t border-border mx-2">
        <p className="text-[10px] uppercase tracking-widest text-text-tertiary font-semibold mb-2">
          {s.layersTitle}
        </p>
        <ul className="flex flex-col gap-1.5">
          {toggles.map(t => (
            <li key={t.id}>
              <button
                type="button"
                onClick={t.onClick}
                aria-pressed={t.active}
                className="group w-full flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-surface-popover/60 transition-colors"
              >
                <span className={`text-xs ${t.active ? 'text-text-primary' : 'text-text-secondary'}`}>
                  {s[t.labelKey]}
                </span>
                <span
                  className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors ${
                    t.active ? t.accent : 'bg-border'
                  }`}
                >
                  <span
                    className={`inline-block h-3 w-3 rounded-full bg-white shadow transition-transform ${
                      t.active ? 'translate-x-[14px]' : 'translate-x-[2px]'
                    }`}
                  />
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  )
}
