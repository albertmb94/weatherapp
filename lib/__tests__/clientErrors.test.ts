import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { huellaError, normalizarError } from '../clientErrors'
import { CLIENT_ERRORS_PATH, reportarError, resetErroresEnviados } from '../reportarError'

/**
 * Captura de errores de cliente.
 *
 * POR QUÉ EXISTE ESTO. La única captura de errores del navegador eran 48
 * `console.error`, o sea, la consola de la persona afectada. Un fallo
 * que reventara la portada a un tercio de los visitantes era invisible
 * hasta que alguien se quejaba — así se detectaron el problema de
 * hidratación y el del seguimiento. `instrumentation.ts` tenía Sentry
 * cableado, pero el paquete no estaba instalado y el guard de runtime lo
 * dejaba sólo en el servidor.
 *
 * Lo que se protege aquí son las dos propiedades que hacen que esto sea
 * telemetría y no seguimiento, y que no se coma la base de datos.
 */

describe('huella de agrupación', () => {
  it('agrupa el mismo error aunque la pila de abajo cambie', () => {
    // Un error dentro de un bucle de render se emite cientos de veces y
    // desde caminos distintos. Si la huella dependiera de la pila
    // entera, un solo fallo se partiría en decenas de grupos y la tabla
    // dejaría de ser legible.
    const a = huellaError('boom', 'Error: boom\n    at Foo (a.js:1:1)\n    at Bar (b.js:2:2)')
    const b = huellaError('boom', 'Error: boom\n    at Foo (a.js:1:1)\n    at Otro (z.js:9:9)')
    expect(a).toBe(b)
  })

  it('separa errores distintos', () => {
    const a = huellaError('boom', 'Error\n    at Foo (a.js:1:1)')
    const b = huellaError('otra cosa', 'Error\n    at Foo (a.js:1:1)')
    expect(a).not.toBe(b)
  })

  it('separa el mismo mensaje lanzado desde sitios distintos', () => {
    const a = huellaError('boom', 'Error\n    at Foo (a.js:1:1)')
    const b = huellaError('boom', 'Error\n    at Baz (c.js:7:7)')
    expect(a).not.toBe(b)
  })

  it('funciona sin pila', () => {
    expect(huellaError('boom')).toBeTruthy()
    expect(huellaError('boom')).toBe(huellaError('boom', null))
  })
})

describe('normalización de lo que llega del navegador', () => {
  it('descarta lo que no aporta nada', () => {
    expect(normalizarError(null)).toBeNull()
    expect(normalizarError('boom')).toBeNull()
    expect(normalizarError({})).toBeNull()
    expect(normalizarError({ message: '   ' })).toBeNull()
  })

  it('QUITA LA QUERY DE LA RUTA', () => {
    // En esta app el query string lleva latitud y longitud. Guardar la
    // ubicación de alguien junto a un error sería recoger un dato
    // personal por la puerta de atrás, en una ruta cuya razón de ser es
    // funcionar SIN consentimiento.
    const n = normalizarError({ message: 'boom', path: '/?lat=41.3874&lon=2.1686#tabla' })
    expect(n?.path).toBe('/')
    expect(n?.path).not.toContain('lat')
  })

  it('recorta mensajes y pilas enormes', () => {
    const n = normalizarError({ message: 'x'.repeat(5000), stack: 'y'.repeat(50_000) })
    expect(n!.message.length).toBeLessThanOrEqual(500)
    expect(n!.stack!.length).toBeLessThanOrEqual(4000)
  })
})

describe('envío desde el cliente', () => {
  const llamadas: { url: string; init: RequestInit }[] = []

  beforeEach(() => {
    llamadas.length = 0
    resetErroresEnviados()
    vi.stubGlobal('fetch', ((url: string, init: RequestInit) => {
      llamadas.push({ url, init })
      return Promise.resolve(new Response(null, { status: 204 }))
    }) as unknown as typeof fetch)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('envía sin cookies', () => {
    // `sendBeacon` manda SIEMPRE las cookies del origen y no se puede
    // desactivar. Esta ruta existe para ver también los fallos de quien
    // no ha consentido —el muro de cookies es lo primero que se pinta,
    // así que es donde más probable es que algo reviente—, y recibir
    // `wthr_anon` aquí convertiría telemetría anónima en seguimiento.
    reportarError(new Error('boom'))
    expect(llamadas).toHaveLength(1)
    expect(llamadas[0].url).toBe(CLIENT_ERRORS_PATH)
    expect(llamadas[0].init.credentials).toBe('omit')
  })

  it('no repite el mismo error en la misma carga', () => {
    // Un error en bucle de render generaría una petición por fotograma.
    const e = new Error('boom')
    reportarError(e)
    reportarError(e)
    reportarError(e)
    expect(llamadas).toHaveLength(1)
  })

  it('sí envía errores distintos', () => {
    reportarError(new Error('uno'))
    reportarError(new Error('dos'))
    expect(llamadas).toHaveLength(2)
  })

  it('no lanza si fetch revienta', () => {
    // Se ejecuta cuando la app YA está rota: una excepción aquí se
    // comería el fallback de error y dejaría la pantalla en blanco.
    vi.stubGlobal('fetch', (() => {
      throw new Error('sin red')
    }) as unknown as typeof fetch)
    expect(() => reportarError(new Error('boom'))).not.toThrow()
  })

  it('acepta lo que no es un Error', () => {
    reportarError('una cadena suelta')
    expect(llamadas).toHaveLength(1)
    const cuerpo = JSON.parse(String(llamadas[0].init.body)) as { message: string }
    expect(cuerpo.message).toContain('una cadena suelta')
  })

  it('el contexto acompaña al mensaje', () => {
    reportarError(new Error('boom'), 'ErrorBoundary')
    const cuerpo = JSON.parse(String(llamadas[0].init.body)) as { message: string }
    expect(cuerpo.message).toBe('ErrorBoundary: boom')
  })
})
