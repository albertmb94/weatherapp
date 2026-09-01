import { DEFAULT_LOCALE, isLocale } from '@/lib/locale/routing'
import { TAMANO, altPara, tarjetaSocial } from '@/lib/og/tarjetaSocial'

/**
 * Tarjeta social de las páginas públicas, en el idioma de la URL.
 *
 * Sin esto, alguien compartiendo `/en/...` obtenía una tarjeta en
 * español: justo el público al que más le cuesta entrar.
 */

export const alt = altPara(DEFAULT_LOCALE)
export const size = TAMANO
export const contentType = 'image/png'

export default async function Image({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  return tarjetaSocial(isLocale(locale) ? locale : DEFAULT_LOCALE)
}
