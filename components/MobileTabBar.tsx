'use client'

import { useLocale } from '@/lib/LocaleContext'

// B-NEW-37 (2026-08-18): 'map' removed from MobileTab. The Mapa view is
// disabled in this build, so the bottom tab bar exposes only the live
// views (Models / Stations).
export type MobileTab = 'models' | 'stations'

interface TabDef {
  id: MobileTab
  labelEn: string
  labelEs: string
  icon: React.ReactNode
  ariaEn: string
  ariaEs: string
}

const TABS: TabDef[] = [
  {
    id: 'models',
    labelEn: 'Models',
    labelEs: 'Modelos',
    ariaEn: 'Models',
    ariaEs: 'Modelos',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 17l6-6 4 4 8-8" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M14 7h7v7" />
      </svg>
    ),
  },
  {
    id: 'stations',
    labelEn: 'Stations',
    labelEs: 'Estaciones',
    ariaEn: 'Stations',
    ariaEs: 'Estaciones',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
]

interface MobileTabBarProps {
  active: MobileTab
  onChange: (next: MobileTab) => void
}

export default function MobileTabBar({ active, onChange }: MobileTabBarProps) {
  // S7.3: bottom tab bar, mobile portrait only (md:hidden + landscape:hidden).
  // The page already has a top toolbar with secondary actions (CSV, theme,
  // language, save, marine) in the hamburger menu; the tab bar is the
  // primary navigation surface for "which slice of the app am I in".
  const { locale } = useLocale()
  return (
    <nav
      aria-label={locale === 'en' ? 'Primary navigation' : 'Navegación principal'}
      className="real-desktop:hidden fixed bottom-0 left-0 right-0 z-[1200] bg-surface-raised border-t border-border flex items-stretch"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {TABS.map(tab => {
        const isActive = active === tab.id
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            aria-current={isActive ? 'page' : undefined}
            aria-pressed={isActive}
            aria-label={locale === 'en' ? tab.ariaEn : tab.ariaEs}
            className={`tab flex-1 min-h-[52px] py-1.5 flex flex-col items-center justify-center gap-0.5 transition-colors ${
              isActive ? 'text-accent' : 'text-text-tertiary hover:text-text-secondary'
            }`}
          >
            {tab.icon}
            <span className="text-[10px] font-medium">{locale === 'en' ? tab.labelEn : tab.labelEs}</span>
          </button>
        )
      })}
    </nav>
  )
}
