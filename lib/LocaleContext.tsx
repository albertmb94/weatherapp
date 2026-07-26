'use client'

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Locale } from './i18n'
import { LOCALE_STORAGE_KEY } from './i18n'

interface LocaleContextValue {
  locale: Locale
  setLocale: (l: Locale) => void
  toggleLocale: () => void
}

const LocaleContext = createContext<LocaleContextValue | null>(null)

const DEFAULT_LOCALE: Locale = 'es'

// M3: avoid hydration mismatch. The server always renders the default
// locale; on the client we read localStorage / navigator.language on
// mount. To keep the first client paint matching the server, we defer
// the localStorage read to a useEffect and let React know via
// useState + a `hydrated` flag.
//
// The previous useSyncExternalStore + manual storage event approach
// had a subtle bug: when the user pressed the ES/EN button, setLocale
// wrote to localStorage and dispatched a storage event, but
// useSyncExternalStore only re-reads the snapshot when the component
// re-renders for *another* reason (because subscribe is a no-op). The
// button press alone wasn't a render trigger, so the UI never updated
// until something else (a query, a popstate, etc.) forced a render.
function readInitial(): Locale {
  if (typeof window === 'undefined') return DEFAULT_LOCALE
  const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY)
  if (stored === 'en' || stored === 'es') return stored
  return navigator.language?.startsWith('en') ? 'en' : 'es'
}

export function LocaleProvider({ children, initialLocale }: { children: ReactNode; initialLocale?: Locale }) {
  // Always start with the server default to avoid hydration mismatch;
  // a useEffect below brings the client snapshot in. The `initialLocale`
  // prop is only used by tests to skip the storage/navigator read and
  // force a specific locale; production callers should omit it.
  const [locale, setLocaleState] = useState<Locale>(initialLocale ?? DEFAULT_LOCALE)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    if (initialLocale) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHydrated(true)
      return
    }
    setLocaleState(readInitial())
    setHydrated(true)
  }, [initialLocale])

  useEffect(() => {
    if (!hydrated) return
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, locale)
    }
    document.documentElement.lang = locale
  }, [locale, hydrated])

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l)
  }, [])

  const toggleLocale = useCallback(() => {
    setLocaleState(prev => (prev === 'es' ? 'en' : 'es'))
  }, [])

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
