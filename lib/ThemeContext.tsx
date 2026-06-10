'use client'

import { createContext, useCallback, useContext, useEffect, useSyncExternalStore, type ReactNode } from 'react'

export type Theme = 'dark' | 'light'

interface ThemeContextValue {
  theme: Theme
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)
const THEME_STORAGE_KEY = 'weather-theme'
const DEFAULT_THEME: Theme = 'dark'
const SERVER_SNAPSHOT: Theme = DEFAULT_THEME

// M3: same pattern as LocaleContext — useSyncExternalStore to read
// from localStorage without triggering a setState-in-effect lint error.
function getClientSnapshot(): Theme {
  if (typeof window === 'undefined') return DEFAULT_THEME
  const stored = localStorage.getItem(THEME_STORAGE_KEY)
  if (stored === 'light' || stored === 'dark') return stored
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

function subscribe(cb: () => void): () => void {
  // Subscribe to the storage event for cross-tab changes.
  window.addEventListener('storage', cb)
  return () => window.removeEventListener('storage', cb)
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useSyncExternalStore(subscribe, getClientSnapshot, () => SERVER_SNAPSHOT)

  useEffect(() => {
    if (typeof window === 'undefined') return
    localStorage.setItem(THEME_STORAGE_KEY, theme)
    document.documentElement.classList.toggle('light', theme === 'light')
  }, [theme])

  const toggleTheme = useCallback(() => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    if (typeof window !== 'undefined') {
      localStorage.setItem(THEME_STORAGE_KEY, next)
    }
    document.documentElement.classList.toggle('light', next === 'light')
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new StorageEvent('storage', {
        key: THEME_STORAGE_KEY,
        newValue: next,
        storageArea: window.localStorage,
      }))
    }
  }, [theme])

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
