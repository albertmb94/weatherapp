'use client'

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { reportarError } from '@/lib/reportarError'
import type { Locale } from '@/lib/i18n'

interface Props {
  children: ReactNode
  fallback?: ReactNode
  /**
   * Idioma, entregado desde el layout raíz.
   *
   * No se usa `useLocale()` y no es un descuido: este componente está
   * POR ENCIMA de `LocaleProvider` en el árbol (lo envuelve todo,
   * incluido el segmento `[locale]`), y además es una clase. Si el
   * proveedor es justo lo que ha reventado, un hook de contexto aquí
   * fallaría dentro del propio manejador de errores.
   */
  locale?: Locale
}

interface State {
  hasError: boolean
  error: Error | null
}

const TEXTOS: Record<Locale, { titulo: string; cuerpo: string; recargar: string }> = {
  es: {
    titulo: 'Algo ha salido mal',
    // NO se muestra `error.message`. Antes sí, y era un error doble:
    // a quien lo lee no le dice nada ("Cannot read properties of
    // undefined") y a quien no debería, le enseña la tripa. El mensaje
    // real va al servidor, que es donde sirve para algo.
    cuerpo: 'No hemos podido cargar esta parte de la aplicación. Ya lo hemos registrado; prueba a recargar.',
    recargar: 'Recargar',
  },
  en: {
    titulo: 'Something went wrong',
    cuerpo: 'We could not load this part of the app. It has been logged; try reloading.',
    recargar: 'Reload',
  },
}

/**
 * Última red de seguridad de la interfaz.
 *
 * AUDITORÍA — tenía tres problemas, y los tres importaban:
 *
 *  1. `componentDidCatch` sólo hacía `console.error`, es decir, escribía
 *     en la consola de la persona afectada. Envuelve la aplicación
 *     entera, así que era el sitio donde MÁS falta hacía enterarse y era
 *     justo donde nadie se enteraba.
 *  2. El texto estaba en inglés a fuego, mientras `app/error.tsx` sí era
 *     bilingüe. Quien navega en español veía la única pantalla que
 *     explica qué ha pasado en otro idioma.
 *  3. Usaba `bg-gray-950 text-white` en vez de los tokens del tema: en
 *     tema claro salía un rectángulo negro a pantalla completa.
 */
export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info.componentStack)
    // Ahora también sale del navegador de quien lo sufre. `reportarError`
    // deduplica por carga y no lanza nunca.
    reportarError(error, 'ErrorBoundary')
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback
      const t = TEXTOS[this.props.locale ?? 'es']
      return (
        <div className="h-screen flex flex-col items-center justify-center bg-background text-foreground p-6">
          <svg
            className="w-12 h-12 text-red-400 mb-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
            />
          </svg>
          <h2 className="text-lg font-semibold mb-2">{t.titulo}</h2>
          <p className="text-sm text-text-secondary mb-4 text-center max-w-md">{t.cuerpo}</p>
          <button
            onClick={() => {
              this.setState({ hasError: false, error: null })
              window.location.reload()
            }}
            className="px-4 py-2 bg-accent hover:bg-accent-hover text-white rounded text-sm font-medium transition-colors cursor-pointer"
          >
            {t.recargar}
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
