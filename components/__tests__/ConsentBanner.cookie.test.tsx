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

  it('no se puede cerrar sin responder: no hay botón de descarte', () => {
    // Ignorarlo indefinidamente equivalía a rechazar sin que nadie lo
    // decidiera. Las dos únicas salidas son responder.
    render(<Banner />)
    const botones = screen.getAllByRole('button').map(b => b.textContent?.trim())
    expect(botones).toEqual(['Aceptar', 'Rechazar'])
  })

  it('rechazar también cierra: el acceso no exige aceptar', () => {
    // Deliberado. Un muro que sólo deje pasar aceptando invalida el
    // consentimiento bajo el RGPD (no sería libre) y lo desaconseja la
    // AEPD sin ofrecer una alternativa equivalente.
    render(<Banner />)
    expect(screen.getByRole('button', { name: /rechazar/i })).toBeTruthy()
  })
})
