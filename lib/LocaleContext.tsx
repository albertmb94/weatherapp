'use client'

import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import type { Locale } from './i18n'
import { LOCALE_STORAGE_KEY } from './i18n'
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  splitLocale,
  switchLocaleUrl,
} from './locale/routing'

interface LocaleContextValue {
  locale: Locale
  setLocale: (l: Locale) => void
  toggleLocale: () => void
}

const LocaleContext = createContext<LocaleContextValue | null>(null)

export { DEFAULT_LOCALE }

/**
 * El idioma sale de la URL, y de ningún otro sitio.
 *
 * ANTES vivía sólo en localStorage y el servidor renderizaba SIEMPRE el
 * idioma por defecto para no romper la hidratación; el idioma real
 * llegaba en un efecto posterior. Eso implicaba que:
 *
 *   - Todo rastreador y todo lector de pantalla veía español.
 *   - El idioma no se podía compartir en un enlace ni marcar en
 *     favoritos: abrir la misma URL en otro dispositivo daba español.
 *   - El primer render siempre era el idioma equivocado para la mitad de
 *     los visitantes, con su parpadeo correspondiente.
 *
 * Con el idioma en la ruta, `usePathname()` lo devuelve idéntico en
 * servidor y en cliente, así que no hay desajuste de hidratación ni
 * efecto que corrija nada.
 *
 * Nota sobre el prefijo "sólo cuando hace falta": para el español la
 * ruta no lleva prefijo y el proxy la reescribe internamente. El
 * navegador ve `/premium`, así que `usePathname()` devuelve `/premium`,
 * `splitLocale` no encuentra prefijo y cae al idioma por defecto — que
 * es exactamente lo correcto.
 */
export function LocaleProvider({
  children,
  initialLocale,
}: {
  children: ReactNode
  /** Sólo para tests: fuerza un idioma sin depender de la ruta. */
  initialLocale?: Locale
}) {
  // `usePathname` devuelve null fuera del router (tests de componentes
  // que montan el proveedor suelto); el `?? '/'` lo cubre.
  const pathname = usePathname()

  const locale: Locale = useMemo(() => {
    if (initialLocale) return initialLocale
    return splitLocale(pathname ?? '/').locale ?? DEFAULT_LOCALE
  }, [initialLocale, pathname])

  const setLocale = useCallback(
    (next: Locale) => {
      if (next === locale) return
      if (typeof window === 'undefined') return

      // Se recuerda la elección para que el proxy pueda respetarla
      // cuando el visitante vuelva a entrar por una URL sin prefijo. Es
      // una elección EXPLÍCITA de la persona, no una deducción a partir
      // de Accept-Language, que es lo que la hace segura para SEO.
      try {
        localStorage.setItem(LOCALE_STORAGE_KEY, next)
      } catch {
        /* storage bloqueado */
      }
      try {
        document.cookie = `${LOCALE_COOKIE}=${next};max-age=${60 * 60 * 24 * 365};path=/;samesite=lax`
      } catch {
        /* ignore */
      }

      const destino = switchLocaleUrl(
        window.location.pathname,
        window.location.search,
        next,
      )

      // NAVEGACIÓN COMPLETA, no `router.push`, y no por comodidad:
      // `<html lang>` lo emite el layout RAÍZ a partir de una cabecera
      // que escribe el proxy, y una navegación de cliente no vuelve a
      // renderizar el layout raíz. Con `router.push` la página cambiaría
      // de idioma pero el documento seguiría anunciando `lang="es"` — es
      // decir, se arreglaría lo visible y se dejaría roto exactamente lo
      // que este refactor venía a arreglar. Cambiar de idioma es un
      // cambio de documento.
      window.location.assign(destino)
    },
    [locale],
  )

  const toggleLocale = useCallback(() => {
    setLocale(locale === 'es' ? 'en' : 'es')
  }, [locale, setLocale])

  const value = useMemo(
    () => ({ locale, setLocale, toggleLocale }),
    [locale, setLocale, toggleLocale],
  )

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext)
  if (!ctx) throw new Error('useLocale must be used within LocaleProvider')
  return ctx
}
