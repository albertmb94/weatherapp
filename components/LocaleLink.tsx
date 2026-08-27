'use client'

import Link from 'next/link'
import type { ComponentProps } from 'react'
import { useLocale } from '@/lib/LocaleContext'
import { localizedHref } from '@/lib/locale/routing'

type LinkProps = ComponentProps<typeof Link>

/**
 * Enlace interno que conserva el idioma.
 *
 * Sin esto, cualquier `<Link href="/premium">` dentro de la versión
 * inglesa devolvía al visitante al español a mitad de navegación: el
 * idioma vive en la ruta, así que un href sin prefijo ES una ruta en
 * español. Aquí se aplica `localizedHref` con el idioma actual.
 *
 * Acepta sólo hrefs internos en forma de cadena. Para enlaces externos o
 * a rutas exentas (/api, /admin) usa `<Link>` o `<a>` directamente:
 * `localizedHref` los deja pasar sin tocar, pero pasar por aquí sólo
 * añade ruido.
 */
export default function LocaleLink({ href, ...rest }: Omit<LinkProps, 'href'> & { href: string }) {
  const { locale } = useLocale()
  return <Link href={localizedHref(href, locale)} {...rest} />
}
