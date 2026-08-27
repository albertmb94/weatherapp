import type { Metadata } from 'next'
import { makeGenerateMetadata } from '@/lib/locale/pageMeta'
import PrivacyContent from './content'

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
  title: { es: 'Privacidad', en: 'Privacy' },
  description: {
    es: 'Qué datos tratamos, con qué base legal y durante cuánto tiempo.',
    en: 'What data we process, on what legal basis, and for how long.',
  },
}

export const generateMetadata: (args: {
  params: Promise<{ locale: string }>
}) => Promise<Metadata> = makeGenerateMetadata('/privacy', COPY)

export default function Page() {
  return <PrivacyContent />
}
