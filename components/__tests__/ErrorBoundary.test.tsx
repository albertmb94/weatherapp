import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import ErrorBoundary from '@/components/ErrorBoundary'
import { resetErroresEnviados } from '@/lib/reportarError'

/**
 * La última red de seguridad de la interfaz.
 *
 * TENÍA TRES PROBLEMAS Y LOS TRES IMPORTABAN:
 *
 *  1. `componentDidCatch` sólo hacía `console.error`, es decir, escribía
 *     en la consola de la persona afectada. Envuelve la aplicación
 *     entera: era el sitio donde más falta hacía enterarse y justo donde
 *     nadie se enteraba.
 *  2. El texto estaba en inglés a fuego, mientras `app/error.tsx` sí era
 *     bilingüe. Quien navega en español veía la única pantalla que
 *     explica qué ha pasado en otro idioma.
 *  3. Usaba `bg-gray-950 text-white` en vez de los tokens del tema: en
 *     tema claro salía un rectángulo negro a pantalla completa.
 */

function Explota(): React.ReactElement {
  throw new Error('boom de prueba')
}

describe('ErrorBoundary', () => {
  const llamadas: { url: string; init: RequestInit }[] = []
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    llamadas.length = 0
    resetErroresEnviados()
    vi.stubGlobal('fetch', ((url: string, init: RequestInit) => {
      llamadas.push({ url, init })
      return Promise.resolve(new Response(null, { status: 204 }))
    }) as unknown as typeof fetch)
    // React escribe el error en consola por su cuenta; silenciarlo evita
    // ruido, no evita el test.
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    errorSpy.mockRestore()
    vi.unstubAllGlobals()
    cleanup()
  })

  it('captura el error y NO deja la pantalla en blanco', () => {
    render(
      <ErrorBoundary>
        <Explota />
      </ErrorBoundary>,
    )
    expect(screen.getByRole('button', { name: /recargar/i })).toBeTruthy()
  })

  it('AVISA AL SERVIDOR: es la razón de ser del cambio', () => {
    render(
      <ErrorBoundary>
        <Explota />
      </ErrorBoundary>,
    )
    expect(llamadas.length, 'el error no salió del navegador').toBe(1)
    expect(llamadas[0].url).toBe('/api/client-errors')
    // Sin cookies: puede ocurrirle a quien aún no ha consentido.
    expect(llamadas[0].init.credentials).toBe('omit')
    const cuerpo = JSON.parse(String(llamadas[0].init.body)) as { message: string }
    expect(cuerpo.message).toContain('boom de prueba')
  })

  it('NO enseña el mensaje crudo del error', () => {
    // A quien lo lee no le dice nada ("Cannot read properties of
    // undefined") y a quien no debería, le enseña la tripa. El mensaje
    // real va al servidor, que es donde sirve para algo.
    render(
      <ErrorBoundary>
        <Explota />
      </ErrorBoundary>,
    )
    expect(document.body.textContent).not.toContain('boom de prueba')
  })

  it('habla el idioma que se le entrega', () => {
    const { unmount } = render(
      <ErrorBoundary locale="en">
        <Explota />
      </ErrorBoundary>,
    )
    expect(document.body.textContent).toContain('Something went wrong')
    unmount()

    render(
      <ErrorBoundary locale="es">
        <Explota />
      </ErrorBoundary>,
    )
    expect(document.body.textContent).toContain('Algo ha salido mal')
  })

  it('usa los tokens del tema, no colores fijos', () => {
    // Con `bg-gray-950 text-white`, quien usa el tema claro se comía un
    // rectángulo negro a pantalla completa.
    const { container } = render(
      <ErrorBoundary>
        <Explota />
      </ErrorBoundary>,
    )
    const raiz = container.firstElementChild as HTMLElement
    expect(raiz.className).toContain('bg-background')
    expect(raiz.className).not.toContain('bg-gray-950')
  })

  it('un fallback a medida sustituye a todo lo anterior', () => {
    render(
      <ErrorBoundary fallback={<p>a medida</p>}>
        <Explota />
      </ErrorBoundary>,
    )
    expect(document.body.textContent).toContain('a medida')
  })
})
