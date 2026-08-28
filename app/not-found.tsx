'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { DEFAULT_LOCALE, localizedHref, splitLocale } from '@/lib/locale/routing'

/** Router-level 404 (auditoría F4: no existía un not-found.tsx).
 *
 *  Bilingüe desde el refactor de idioma: antes estaba sólo en español,
 *  igual que error.tsx, de modo que un visitante inglés que llegaba a
 *  una URL rota se encontraba de golpe con un idioma que no eligió. Y el
 *  botón de volver mandaba siempre a la home española, perdiendo el
 *  idioma incluso a quien estaba navegando en /en. */
export default function NotFound() {
  // NO se usa useLocale() a proposito: el 404 de la raiz se renderiza
  // FUERA del LocaleProvider, que vive en app/[locale]/layout.tsx, asi
  // que useLocale() lanzaba "must be used within LocaleProvider" durante
  // el render del servidor. El error solo aparecia en el log del
  // servidor, no en la consola del navegador, asi que era facil no
  // verlo. El idioma se lee de la ruta, que siempre esta disponible
  // (mismo enfoque que app/error.tsx).
  const pathname = usePathname()
  const locale = splitLocale(pathname ?? '/').locale ?? DEFAULT_LOCALE
  const es = locale === 'es'

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background text-foreground p-6">
      <div className="text-5xl mb-4">🧭</div>
      <h2 className="text-xl font-semibold mb-2">
        {es ? 'Página no encontrada' : 'Page not found'}
      </h2>
      <p className="text-sm text-text-tertiary mb-6 text-center max-w-md">
        {es
          ? 'La página que buscas no existe o ha cambiado de dirección.'
          : 'The page you are looking for does not exist or has moved.'}
      </p>
      <Link
        href={localizedHref('/', locale)}
        className="px-4 py-2 bg-accent hover:bg-accent/90 rounded text-sm font-medium transition-colors text-white"
      >
        {es ? 'Volver a la app' : 'Back to the app'}
      </Link>
    </div>
  )
}
