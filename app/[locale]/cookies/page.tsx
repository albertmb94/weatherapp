import type { Metadata } from 'next'
import { makeGenerateMetadata } from '@/lib/locale/pageMeta'
import CookiesContent from './content'

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
  title: { es: 'Política de cookies', en: 'Cookie policy' },
  description: {
    es: 'Qué cookies usamos, para qué, y cómo cambiar tu elección en cualquier momento.',
    en: 'Which cookies we use, what for, and how to change your choice at any time.',
  },
}

export const generateMetadata: (args: {
  params: Promise<{ locale: string }>
}) => Promise<Metadata> = makeGenerateMetadata('/cookies', COPY)

export default function Page() {
  return <CookiesContent />
}
