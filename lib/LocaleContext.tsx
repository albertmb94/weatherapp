'use client'

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import type { Locale } from './i18n'
import { LOCALE_STORAGE_KEY } from './i18n'

interface LocaleContextValue {
  locale: Locale
  setLocale: (l: Locale) => void
  toggleLocale: () => void
}

const LocaleContext = createContext<LocaleContextValue | null>(null)

// M3: avoid hydration mismatch. On the server we always render the default
// locale; on the client we read localStorage / navigator.language in an
// effect after mount. This prevents a server-vs-client DOM diff on the
// `<html lang="…">` attribute and on any text rendered in the first paint.
function getDefaultLocale(): Locale {
  return 'es'
}

function detectClientLocale(): Locale {
  if (typeof window === 'undefined') return 'es'
  const stored = localStorage.getItem(LOCALE_STORAGE_KEY)
  if (stored === 'en' || stored === 'es') return stored
  return navigator.language?.startsWith('en') ? 'en' : 'es'
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(getDefaultLocale)

  useEffect(() => {
    const detected = detectClientLocale()
    if (detected !== locale) setLocaleState(detected)
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    localStorage.setItem(LOCALE_STORAGE_KEY, locale)
    document.documentElement.lang = locale
  }, [locale])

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l)
  }, [])

  const toggleLocale = useCallback(() => {
    setLocaleState(prev => prev === 'es' ? 'en' : 'es')
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
