'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { splitLocale, DEFAULT_LOCALE } from '@/lib/locale/routing'

/** Router-level error boundary (auditoría F4: no existía ningún
 *  error.tsx/not-found.tsx/loading.tsx bajo app/).
 *
 *  Bilingüe desde el refactor de idioma. NO usa `useLocale()` a
 *  propósito: este límite de error puede dispararse porque el propio
 *  árbol de proveedores ha fallado, y entonces el contexto no existe y
 *  el hook lanzaría — un error dentro del gestor de errores. Se lee el
 *  idioma directamente de la ruta, que siempre está disponible. */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const pathname = usePathname()
  const locale = splitLocale(pathname ?? '/').locale ?? DEFAULT_LOCALE
  const es = locale === 'es'

  useEffect(() => {
    console.error('Unhandled error:', error)
  }, [error])

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background text-foreground p-6">
      <div className="w-12 h-12 text-red-400 mb-4 flex items-center justify-center text-2xl">⚠️</div>
      <h2 className="text-lg font-semibold mb-2">
        {es ? 'Algo salió mal' : 'Something went wrong'}
      </h2>
      <p className="text-sm text-text-tertiary mb-4 text-center max-w-md">
        {es
          ? 'Se produjo un error inesperado. Inténtalo de nuevo.'
          : 'An unexpected error occurred. Please try again.'}
        {error.digest ? (
          <span className="block mt-1 text-[11px]">
            {es ? 'Código' : 'Code'}: {error.digest}
          </span>
        ) : null}
      </p>
      <button
        onClick={reset}
        className="px-4 py-2 bg-accent hover:bg-accent/90 rounded text-sm font-medium transition-colors cursor-pointer text-white"
      >
        {es ? 'Reintentar' : 'Try again'}
      </button>
    </div>
  )
}
