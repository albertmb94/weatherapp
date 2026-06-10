'use client'

import { createContext, useCallback, useContext, useEffect, useSyncExternalStore, type ReactNode } from 'react'
import type { Locale } from './i18n'
import { LOCALE_STORAGE_KEY } from './i18n'

interface LocaleContextValue {
  locale: Locale
  setLocale: (l: Locale) => void
  toggleLocale: () => void
}

const LocaleContext = createContext<LocaleContextValue | null>(null)

const DEFAULT_LOCALE: Locale = 'es'
const SERVER_SNAPSHOT: Locale = DEFAULT_LOCALE

// M3: avoid hydration mismatch. The server always renders the default
// locale; on the client we read localStorage / navigator.language via
// useSyncExternalStore (designed exactly for this). The server snapshot
// equals the default so the first client paint matches the server.
function getClientSnapshot(): Locale {
  if (typeof window === 'undefined') return DEFAULT_LOCALE
  const stored = localStorage.getItem(LOCALE_STORAGE_KEY)
  if (stored === 'en' || stored === 'es') return stored
  return navigator.language?.startsWith('en') ? 'en' : 'es'
}

function subscribe(): () => void {
  // Locale changes only happen through setLocale/toggleLocale in this
  // provider, which already re-render. No external subscription needed.
  return () => {}
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const locale = useSyncExternalStore(subscribe, getClientSnapshot, () => SERVER_SNAPSHOT)

  useEffect(() => {
    if (typeof window === 'undefined') return
    localStorage.setItem(LOCALE_STORAGE_KEY, locale)
    document.documentElement.lang = locale
  }, [locale])

  const setLocale = useCallback((l: Locale) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(LOCALE_STORAGE_KEY, l)
    }
    document.documentElement.lang = l
    // Re-render consumers of this context by mutating the key the external
    // store uses. We dispatch a storage event manually so useSyncExternalStore
    // subscribers re-read the snapshot.
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new StorageEvent('storage', {
        key: LOCALE_STORAGE_KEY,
        newValue: l,
        storageArea: window.localStorage,
      }))
    }
  }, [])

  const toggleLocale = useCallback(() => {
    setLocale(locale === 'es' ? 'en' : 'es')
  }, [locale, setLocale])

  return (
    <LocaleContext.Provider value={{ locale, setLocale, toggleLocale }}>
      {children}
    </LocaleContext.Provider>
  )
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext)
  if (!ctx) throw new Error('useLocale must be used within LocaleProvider')
  return ctx
}
