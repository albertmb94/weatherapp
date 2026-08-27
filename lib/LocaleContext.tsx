'use client'

import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react'
import type { Locale } from './i18n'
import { LOCALE_STORAGE_KEY } from './i18n'
import { DEFAULT_LOCALE, LOCALE_COOKIE, switchLocaleUrl } from './locale/routing'

interface LocaleContextValue {
  locale: Locale
  setLocale: (l: Locale) => void
  toggleLocale: () => void
}

const LocaleContext = createContext<LocaleContextValue | null>(null)

export { DEFAULT_LOCALE }

/**
 * El idioma viene de la RUTA, y lo entrega el servidor.
 *
 * ANTES vivía sólo en localStorage y el servidor renderizaba SIEMPRE el
 * idioma por defecto para no romper la hidratación; el idioma real
 * llegaba en un efecto posterior. Eso implicaba que todo rastreador y
 * todo lector de pantalla veía español, y que el idioma no se podía
 * compartir en un enlace.
 *
 * POR QUÉ SE RECIBE COMO PROP Y NO SE LEE CON `usePathname()`:
 *
 * La primera versión de este refactor derivaba el idioma con
 * `usePathname()` aquí dentro. Este proveedor se monta en el layout
 * RAÍZ (app/providers.tsx), por encima del segmento `[locale]`, y usar
 * ahí el hook de ruta ROMPÍA LA HIDRATACIÓN DE TODO EL SUBÁRBOL: la
 * página se pintaba con el HTML del servidor pero React no la
 * adoptaba, así que no corría ningún efecto ni ninguna consulta de
 * react-query. En la práctica: la app aparecía completa pero sin datos
 * —todos los valores con guiones— y sin una sola petición a /api. No
 * había ningún error en consola; se detectó comparando la hidratación
 * contra el build anterior.
 *
 * Ahora `app/[locale]/layout.tsx` monta este proveedor con el idioma
 * que ya conoce por `params`. Es además más correcto: el servidor es la
 * autoridad, no hay derivación duplicada y no puede haber desajuste
 * entre lo que renderiza el servidor y lo que deduce el cliente.
 */
export function LocaleProvider({
  children,
  locale,
}: {
  children: ReactNode
  /** Idioma del segmento de ruta. Lo pasa el layout del servidor. */
  locale: Locale
}) {
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

      const destino = switchLocaleUrl(window.location.pathname, window.location.search, next)

      // NAVEGACIÓN COMPLETA, no `router.push`, y no por comodidad:
      // `<html lang>` lo emite el layout RAÍZ a partir de una cabecera
      // que escribe el proxy, y una navegación de cliente no vuelve a
      // renderizar el layout raíz. Con `router.push` la página cambiaría
      // de idioma pero el documento seguiría anunciando `lang="es"` — es
      // decir, se arreglaría lo visible y se dejaría roto exactamente lo
      // que este refactor venía a arreglar.
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
