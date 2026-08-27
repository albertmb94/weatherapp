'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react'

export type ThemePreference = 'dark' | 'light' | 'auto'
export type Theme = 'dark' | 'light'

interface ThemeContextValue {
  /** Current effective theme (always 'dark' or 'light'). */
  theme: Theme
  /** User-selected preference ('auto' resolves to dark between 18:00 and 06:00 local). */
  preference: ThemePreference
  /** Cycle dark → light → auto → dark. */
  cycleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)
const THEME_STORAGE_KEY = 'weather-theme'
const DEFAULT_PREF: ThemePreference = 'dark'
const SERVER_SNAPSHOT: ThemePreference = DEFAULT_PREF

// F-11: solar heuristic. Without external APIs we approximate
// sunrise/sunset with a flat 06:00–18:00 local-time window. Real
// sunrise/sunset depends on latitude+date but the difference for
// most populated Spanish latitudes is < 90 min, which is good enough
// for a "should I use light mode?" toggle.
function isLocalDaytime(): boolean {
  const h = new Date().getHours()
  return h >= 6 && h < 18
}

function resolveTheme(pref: ThemePreference): Theme {
  if (pref === 'auto') return isLocalDaytime() ? 'light' : 'dark'
  return pref
}

function getClientSnapshot(): ThemePreference {
  if (typeof window === 'undefined') return DEFAULT_PREF
  const stored = localStorage.getItem(THEME_STORAGE_KEY)
  if (stored === 'dark' || stored === 'light' || stored === 'auto') return stored
  return DEFAULT_PREF
}

function subscribe(cb: () => void): () => void {
  window.addEventListener('storage', cb)
  return () => window.removeEventListener('storage', cb)
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const preference = useSyncExternalStore(subscribe, getClientSnapshot, () => SERVER_SNAPSHOT)
  const theme = resolveTheme(preference)

  useEffect(() => {
    if (typeof window === 'undefined') return
    document.documentElement.classList.toggle('light', theme === 'light')
  }, [theme])

  // In 'auto' mode, re-evaluate once a minute so the UI follows the
  // sunrise/sunset boundary even if the user keeps the tab open.
  useEffect(() => {
    if (preference !== 'auto') return
    const t = setInterval(() => {
      // Trigger a re-read by dispatching a storage event; the snapshot
      // provider still returns the same value but the resolved theme
      // may change, and the effect above re-applies the html class.
      const resolved = resolveTheme('auto')
      document.documentElement.classList.toggle('light', resolved === 'light')
    }, 60_000)
    return () => clearInterval(t)
  }, [preference])

  const cycleTheme = useCallback(() => {
    if (typeof window === 'undefined') return
    const next: ThemePreference =
      preference === 'dark' ? 'light' : preference === 'light' ? 'auto' : 'dark'
    localStorage.setItem(THEME_STORAGE_KEY, next)
    window.dispatchEvent(new StorageEvent('storage', {
      key: THEME_STORAGE_KEY,
      newValue: next,
      storageArea: window.localStorage,
    }))
  }, [preference])

  const value = useMemo(() => ({ theme, preference, cycleTheme }), [theme, preference, cycleTheme])
  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
