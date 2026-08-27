import type { Metadata } from 'next'
import { makeGenerateMetadata } from '@/lib/locale/pageMeta'
import TermsContent from './content'

/**
 * Envoltorio de SERVIDOR.
 *
 * El contenido es un componente de cliente (usa `useLocale`), y un
 * componente de cliente no puede exportar `metadata`. Sin este
 * envoltorio la página heredaba el canonical del layout de idioma, que
 * apunta a la portada: le estaba diciendo a Google que esta página "es"
 * la home, lo que la deja fuera del índice.
 */
const COPY = {
  title: { es: 'Términos', en: 'Terms' },
  description: {
    es: 'Condiciones de uso del servicio.',
    en: 'Terms and conditions of the service.',
  },
}

export const generateMetadata: (args: {
  params: Promise<{ locale: string }>
}) => Promise<Metadata> = makeGenerateMetadata('/terms', COPY)

export default function Page() {
  return <TermsContent />
}
