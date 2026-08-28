import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import HealthPage from '@/app/admin/(authenticated)/health/page'

/**
 * Botón "Consolidar ahora" de /admin/health.
 *
 * POR QUÉ SE PRUEBA AQUÍ Y NO EN E2E: la página vive bajo un layout que
 * hace `getCurrentAdmin()` en el servidor, así que sin una sesión real de
 * administración no se llega a renderizar. El endpoint tiene sus propias
 * pruebas; esto fija el CABLEADO, que es lo que un test de ruta no ve.
 */

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <HealthPage />
    </QueryClientProvider>,
  )
}

const SALUD_CRON_CAIDO = {
  ok: true,
  ts: Date.now(),
  checks: {
    db: { ok: true },
    cron: { ok: false, detail: '4 día(s) de atraso · último: 2026-08-23' },
  },
}

function responder(cuerpo: unknown, status = 200) {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('/admin/health · consolidar analítica a mano', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn(async (url: string | URL | Request) => {
      const u = String(url)
      if (u.includes('/api/health')) return responder(SALUD_CRON_CAIDO)
      if (u.includes('/api/admin/analytics-rollup')) {
        return responder({ ok: true, days: 4, purgedViews: 120 })
      }
      throw new Error(`fetch inesperado: ${u}`)
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('el botón sólo aparece junto al check del cron', async () => {
    montar()
    await screen.findByText(/4 día\(s\) de atraso/)

    // Un único botón de consolidar: no se repite en las demás tarjetas.
    expect(screen.getAllByRole('button', { name: /consolidar ahora/i })).toHaveLength(1)
  })

  it('al pulsarlo llama al endpoint de admin por POST y muestra el resultado', async () => {
    montar()
    await screen.findByText(/4 día\(s\) de atraso/)

    await userEvent.click(screen.getByRole('button', { name: /consolidar ahora/i }))

    await waitFor(() => {
      const llamada = fetchMock.mock.calls.find(c => String(c[0]).includes('analytics-rollup'))
      expect(llamada, 'debe llamar a /api/admin/analytics-rollup').toBeTruthy()
      // La ruta del cron exige CRON_SECRET; el panel NO debe usarla, o el
      // botón fallaría justo cuando esa variable falta.
      expect(String(llamada![0])).toContain('/api/admin/analytics-rollup')
      expect((llamada![1] as RequestInit | undefined)?.method).toBe('POST')
    })

    await screen.findByText(/4 día\(s\) consolidados/)
    expect(screen.getByText(/120 vista\(s\) purgadas/)).toBeTruthy()
  })

  it('un fallo se muestra con su motivo, no en silencio', async () => {
    fetchMock.mockImplementation(async (url: string | URL | Request) => {
      const u = String(url)
      if (u.includes('/api/health')) return responder(SALUD_CRON_CAIDO)
      return responder(
        { ok: false, reason: 'consolidación incompleta: NO se ha purgado nada.', purgeSkipped: true },
        500,
      )
    })
    montar()
    await screen.findByText(/4 día\(s\) de atraso/)

    await userEvent.click(screen.getByRole('button', { name: /consolidar ahora/i }))

    await screen.findByText(/consolidación incompleta/)
  })

  it('mientras corre, el botón se deshabilita para no lanzarlo dos veces', async () => {
    // En un objeto y no en un `let`: el análisis de flujo de TypeScript no
    // ve la asignación de dentro del ejecutor de la promesa y estrecha la
    // variable a `null`, con lo que llamarla luego da "Type 'never' has no
    // call signatures". Una propiedad no se estrecha así.
    const pendiente: { resolver?: (r: Response) => void } = {}
    fetchMock.mockImplementation(async (url: string | URL | Request) => {
      const u = String(url)
      if (u.includes('/api/health')) return responder(SALUD_CRON_CAIDO)
      return new Promise<Response>(res => { pendiente.resolver = res })
    })
    montar()
    await screen.findByText(/4 día\(s\) de atraso/)

    const boton = screen.getByRole('button', { name: /consolidar ahora/i })
    await userEvent.click(boton)

    const enCurso = await screen.findByRole('button', { name: /consolidando/i })
    expect((enCurso as HTMLButtonElement).disabled).toBe(true)

    pendiente.resolver?.(responder({ ok: true, days: 0, purgedViews: 0 }))
    await waitFor(() => expect(screen.getByText(/0 día\(s\) consolidados/)).toBeTruthy())
  })
})
