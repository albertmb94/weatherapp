import { DEFAULT_LOCALE } from '@/lib/locale/routing'
import { TAMANO, altPara, tarjetaSocial } from '@/lib/og/tarjetaSocial'

/**
 * Tarjeta de respaldo para lo que queda FUERA del segmento `[locale]`
 * (por ejemplo /admin, o cualquier ruta nueva sin idioma). Las páginas
 * públicas usan `app/[locale]/opengraph-image.tsx`, que sí conoce el
 * idioma de quien comparte.
 */

export const alt = altPara(DEFAULT_LOCALE)
export const size = TAMANO
export const contentType = 'image/png'

export default async function Image() {
  return tarjetaSocial(DEFAULT_LOCALE)
}
