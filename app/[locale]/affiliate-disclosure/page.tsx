import type { Metadata } from 'next'
import { makeGenerateMetadata } from '@/lib/locale/pageMeta'
import AffiliateDisclosureContent from './content'

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
  title: { es: 'Aviso de afiliados', en: 'Affiliate disclosure' },
  description: {
    es: 'Cómo se financia el proyecto y qué enlaces son de afiliado.',
    en: 'How the project is funded and which links are affiliate links.',
  },
}

export const generateMetadata: (args: {
  params: Promise<{ locale: string }>
}) => Promise<Metadata> = makeGenerateMetadata('/affiliate-disclosure', COPY)

export default function Page() {
  return <AffiliateDisclosureContent />
}
