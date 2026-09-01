import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ConsentBanner from '@/components/ConsentBanner'

vi.mock('next/navigation', () => ({ usePathname: () => '/' }))

/**
 * El banner y la cookie tienen que decir lo mismo.
 *
 * EL FALLO QUE ESTO FIJA. `readStoredChoice` miraba localStorage PRIMERO.
 * localStorage decide si se pinta el banner, pero la COOKIE es lo que el
 * servidor mira para contar. Cuando divergen —la cookie caduca antes (1
 * año frente a los 2 del identificador), la borra una limpieza, o la
 * bloquea una configuración estricta— pasaba lo peor de los dos mundos:
 * el banner NO salía y el servidor NO contaba. Silencioso y permanente.
 *
 * Se detectó porque el autodiagnóstico de /admin/health decía a la vez
 * "consentimiento: sin responder" e "identidad anónima: sí", que es
 * imposible salvo en este caso.
 */

function limpiar() {
  try { localStorage.clear() } catch { /* ignore */ }
  document.cookie = 'wthr_consent=;max-age=0;path=/'
}

function leerCookie(): string | null {
  const m = document.cookie.match(/(?:^|;\s*)wthr_consent=([^;]*)/)
  return m?.[1] ?? null
}

describe('ConsentBanner · coherencia entre localStorage y cookie', () => {
  beforeEach(limpiar)
  afterEach(() => { cleanup(); limpiar() })

  it('sin ninguna respuesta previa, el banner se muestra', () => {
    render(<ConsentBanner />)
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('con la cookie puesta no se muestra', () => {
    document.cookie = 'wthr_consent=granted;path=/'
    render(<ConsentBanner />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('con rastro en localStorage pero SIN cookie, restaura la cookie', () => {
    // El caso real: el banner no salía y el servidor no contaba a nadie.
    localStorage.setItem('wthr_consent', 'granted')
    expect(leerCookie()).toBeNull()

    render(<ConsentBanner />)

    expect(leerCookie(), 'la cookie es lo que gobierna el seguimiento').toBe('granted')
    // No se vuelve a preguntar: la persona ya eligió, lo que se perdió
    // fue el espejo.
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('restaura también un rechazo, no sólo una aceptación', () => {
    // La cookie se restaura igualmente para que cliente y servidor digan
    // lo mismo. Que el diálogo siga apareciendo es otra cosa: sólo
    // aceptar abre el paso.
    localStorage.setItem('wthr_consent', 'rejected')

    render(<ConsentBanner />)

    expect(leerCookie()).toBe('rejected')
  })

  it('restaura el vocabulario antiguo en su forma canónica', () => {
    // Las cookies duran un año: hay quien todavía arrastra 'accept'.
    localStorage.setItem('wthr_consent', 'accept')

    render(<ConsentBanner />)

    expect(leerCookie()).toBe('granted')
  })

  it('al responder escribe la cookie y cierra el diálogo', async () => {
    render(<ConsentBanner />)

    await userEvent.click(screen.getByRole('button', { name: /aceptar/i }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(leerCookie()).toBe('granted')
  })
})

describe('ConsentBanner · diálogo bloqueante', () => {
  // El módulo lleva un guard `answeredInSession` para no remontar el
  // banner tras responder DENTRO del mismo documento. Los tests de
  // arriba responden, así que aquí hay que reimportarlo en limpio o
  // ninguno vería el diálogo.
  let Banner: typeof ConsentBanner

  beforeEach(async () => {
    limpiar()
    vi.resetModules()
    Banner = (await import('@/components/ConsentBanner')).default
  })
  afterEach(() => { cleanup(); limpiar() })

  it('es modal: se anuncia como tal a los lectores de pantalla', () => {
    render(<Banner />)
    expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBe('true')
  })

  it('la única salida es aceptar: no hay botón de rechazo ni de descarte', () => {
    // Decisión de producto: el acceso a los datos exige aceptar. Mientras
    // "Rechazar" no cerrara el diálogo, tenerlo sería peor que no
    // tenerlo — una salida que no lleva a ninguna parte.
    render(<Banner />)
    const botones = screen.getAllByRole('button').map(b => b.textContent?.trim())
    expect(botones).toEqual(['Aceptar y continuar'])
  })

  it('haber RECHAZADO antes no abre el paso: el diálogo vuelve', () => {
    // Si bastara con haber respondido, rechazar una vez sería una puerta
    // trasera: seguirías navegando sin aceptar y sin volver a verlo.
    document.cookie = 'wthr_consent=rejected;path=/'

    render(<Banner />)

    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('haber aceptado sí abre el paso', () => {
    document.cookie = 'wthr_consent=granted;path=/'

    render(<Banner />)

    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('ConsentBanner · páginas legales exentas', () => {
  let Banner: typeof ConsentBanner

  beforeEach(async () => {
    limpiar()
    vi.resetModules()
  })
  afterEach(() => { cleanup(); limpiar() })

  it('la política de cookies se puede leer SIN haber aceptado', async () => {
    // El propio diálogo la enlaza. Con el modal tapándolo todo, no se
    // podría leer antes de decidir — y un consentimiento que no se puede
    // informar no vale.
    vi.doMock('next/navigation', () => ({ usePathname: () => '/cookies' }))
    Banner = (await import('@/components/ConsentBanner')).default

    render(<Banner />)

    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('en el resto de páginas sigue bloqueando', async () => {
    vi.doMock('next/navigation', () => ({ usePathname: () => '/' }))
    Banner = (await import('@/components/ConsentBanner')).default

    render(<Banner />)

    expect(screen.getByRole('dialog')).toBeTruthy()
  })
})

describe('ConsentBanner · idioma de quien lee', () => {
  /**
   * El muro estaba escrito en español a pelo dentro del componente.
   *
   * Mientras fue una tarjeta esquinada que se podía ignorar, era feo
   * pero inocuo. Al convertirlo en diálogo bloqueante pasó a ser lo
   * PRIMERO y lo ÚNICO que veía un visitante anglófono: un modal
   * impenetrable, en un idioma que no entiende, con un solo botón. O
   * aceptaba a ciegas —y un consentimiento que no se comprende no vale
   * como consentimiento informado— o cerraba la pestaña. Afectaba al
   * 100% del tráfico en inglés, justo en la puerta de entrada.
   */
  let Banner: typeof ConsentBanner

  afterEach(() => { cleanup(); limpiar() })

  it('en /en el diálogo se lee en inglés', async () => {
    limpiar()
    vi.resetModules()
    vi.doMock('next/navigation', () => ({ usePathname: () => '/en' }))
    Banner = (await import('@/components/ConsentBanner')).default

    render(<Banner />)

    const dialogo = screen.getByRole('dialog')
    expect(dialogo.textContent).toContain('Before you continue')
    expect(dialogo.textContent).toContain('cookie policy')
    expect(screen.getByRole('button').textContent?.trim()).toBe('Accept and continue')
    // Y no puede quedar ni un resto del texto anterior.
    expect(dialogo.textContent).not.toContain('Antes de continuar')
    expect(dialogo.textContent).not.toContain('Aceptar')
  })

  it('en la raíz sigue en español', async () => {
    limpiar()
    vi.resetModules()
    vi.doMock('next/navigation', () => ({ usePathname: () => '/' }))
    Banner = (await import('@/components/ConsentBanner')).default

    render(<Banner />)

    const dialogo = screen.getByRole('dialog')
    expect(dialogo.textContent).toContain('Antes de continuar')
    expect(screen.getByRole('button').textContent?.trim()).toBe('Aceptar y continuar')
  })

  it('el enlace a la política apunta al idioma activo', async () => {
    limpiar()
    vi.resetModules()
    vi.doMock('next/navigation', () => ({ usePathname: () => '/en' }))
    Banner = (await import('@/components/ConsentBanner')).default

    render(<Banner />)

    const enlace = screen.getByRole('link') as HTMLAnchorElement
    expect(enlace.getAttribute('href')).toBe('/en/cookies')
  })
})
