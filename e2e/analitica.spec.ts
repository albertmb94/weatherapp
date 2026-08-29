import { test, expect, type Page, type BrowserContext } from '@playwright/test'
import { createClient } from '@libsql/client'

/**
 * Verificación de punta a punta del recuento de DISPOSITIVOS y CIUDADES.
 *
 * Los demás tests comprueban tramos sueltos: que el cliente emite, que la
 * ruta acepta, que el rollup agrega. Ninguno comprobaba lo único que le
 * importa a quien mira el panel: que N navegadores distintos consultando
 * M ciudades acaben siendo N dispositivos y M ciudades.
 *
 * Se conduce el navegador de verdad y luego se consulta la BASE DE DATOS
 * directamente (el proceso de Playwright corre en Node y el servidor de
 * pruebas usa `file:local.db`). Así se cubre el camino entero —
 * consentimiento, beacon, ingesta, identidad, sesión— y no una imitación.
 *
 * NO SE BORRA NADA de la base local: cada test marca su propio tráfico
 * con un `utm_source` único y sólo consulta las filas de esa marca. Un
 * test no debe llevarse por delante los datos de desarrollo de nadie.
 *
 * LA MARCA NO ES COSMÉTICA. La primera versión miraba "los anon_id que no
 * existían antes de empezar", y con `fullyParallel` eso recogía el
 * tráfico de los otros specs y de los otros proyectos (escritorio y
 * móvil) corriendo a la vez contra la misma base: los recuentos salían
 * inflados y el test fallaba por interferencia, no por un fallo real.
 * `utm_source` viaja en la URL, lo graba la ingesta en cada fila y
 * también lo recoge el bootstrap del proxy, así que aísla el experimento
 * entero sin apagar el paralelismo.
 */

const CIUDADES = {
  calella: { lat: 41.6138, lon: 2.6542, celda: '41.61,2.65' },
  sevilla: { lat: 37.3891, lon: -5.9845, celda: '37.39,-5.98' },
  // Coordenadas ELEGIDAS lejos de la frontera de redondeo: la celda son
  // 2 decimales, y un valor como -2.935 cae justo en el borde y puede dar
  // -2.93 o -2.94 según la representación en coma flotante.
  bilbao: { lat: 43.2627, lon: -2.9253, celda: '43.26,-2.93' },
}

const db = createClient({ url: 'file:local.db' })

function hoy(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date())
}

let n = 0
/** Marca única para el tráfico de un test. */
function nuevaMarca(): string {
  return `e2e${Date.now().toString(36)}x${++n}`
}

interface Fila {
  anon: string
  celda: string | null
  sesion: string
}

async function filasDe(marca: string): Promise<Fila[]> {
  const r = await db.execute({
    sql: 'SELECT anon_id, geo_cell, session_id FROM page_views WHERE day = ? AND utm_source = ?',
    args: [hoy(), marca],
  })
  return r.rows.map(x => ({
    anon: String(x.anon_id),
    celda: x.geo_cell === null ? null : String(x.geo_cell),
    sesion: String(x.session_id),
  }))
}

/**
 * Acepta el consentimiento y espera a que el primer pageview haya sido
 * RESPONDIDO.
 *
 * Esperar sólo a que la petición salga no basta, y la diferencia importa:
 * la identidad la acuña el servidor y viaja en el `Set-Cookie` de esa
 * respuesta. Si se navega antes de recibirla, el proxy no ve todavía la
 * cookie, acuña otra identidad y el mismo visitante cuenta como dos
 * dispositivos.
 *
 * QUEDA UNA CARRERA RESIDUAL, y es inherente a tener dos emisores de
 * identidad: /api/ingest la acuña para quien acepta y no vuelve a
 * navegar, y el proxy para quien tiene el JS bloqueado. Cada uno cubre un
 * caso que el otro no puede. En la práctica la ventana es el tiempo de
 * ida y vuelta del beacon —milisegundos— y sólo afecta a la PRIMERA
 * visita de alguien que acepte y navegue de inmediato. Aquí se espera la
 * respuesta para medir lo que hace un visitante real, no para esconder
 * la carrera.
 */
async function visitanteQueAcepta(page: Page, marca: string): Promise<void> {
  await page.goto(`/?utm_source=${marca}`)
  const aceptar = page.locator('[data-consent-choice="accept"]').first()
  await expect(aceptar).toBeVisible({ timeout: 25_000 })
  const primera = page.waitForResponse(
    r => new URL(r.url()).pathname === '/api/ingest',
    { timeout: 20_000 },
  )
  await aceptar.click()
  await primera
}

/** Cambia de ciudad por la URL y espera a que se registre esa celda. */
async function consultarCiudad(
  page: Page,
  ciudad: { lat: number; lon: number },
  marca: string,
): Promise<void> {
  const ingesta = page.waitForResponse(
    r => new URL(r.url()).pathname === '/api/ingest',
    { timeout: 20_000 },
  )
  await page.goto(`/?utm_source=${marca}&lat=${ciudad.lat}&lon=${ciudad.lon}`)
  await ingesta
  // El beacon es asíncrono respecto a la escritura: se deja margen para
  // que la fila esté en la base antes de consultarla.
  await page.waitForTimeout(1200)
}

async function nuevoVisitante(context: BrowserContext): Promise<Page> {
  await context.clearCookies()
  return context.newPage()
}

test.describe('recuento de dispositivos y ciudades', () => {
  test('@api un navegador que consulta tres ciudades = 1 dispositivo, 3 ciudades', async ({ page }) => {
    const marca = nuevaMarca()

    await visitanteQueAcepta(page, marca)
    await consultarCiudad(page, CIUDADES.calella, marca)
    await consultarCiudad(page, CIUDADES.sevilla, marca)
    await consultarCiudad(page, CIUDADES.bilbao, marca)

    const filas = await filasDe(marca)
    const dispositivos = new Set(filas.map(f => f.anon))
    const celdas = new Set(filas.map(f => f.celda).filter(Boolean))

    expect(
      dispositivos.size,
      `un solo navegador es UN dispositivo; filas: ${JSON.stringify(filas)}`,
    ).toBe(1)
    for (const c of [CIUDADES.calella, CIUDADES.sevilla, CIUDADES.bilbao]) {
      expect([...celdas], `falta la celda ${c.celda}`).toContain(c.celda)
    }
  })

  test('@api dos navegadores distintos = 2 dispositivos', async ({ browser }) => {
    const marca = nuevaMarca()

    for (const _ of [1, 2]) {
      const ctx = await browser.newContext()
      const p = await ctx.newPage()
      await visitanteQueAcepta(p, marca)
      await consultarCiudad(p, CIUDADES.calella, marca)
      await ctx.close()
    }

    const filas = await filasDe(marca)
    const dispositivos = new Set(filas.map(f => f.anon))

    // Si la identidad se compartiera (o no se acuñara), esto sería 1 o 0
    // y el panel contaría de menos — el síntoma que se venía arrastrando.
    expect(dispositivos.size, 'dos navegadores son DOS dispositivos').toBe(2)
    // Y la ciudad que consultan LOS DOS aparece una sola vez en el
    // desglose: dos dispositivos en la misma ciudad no son dos ciudades.
    // (La portada registra además la ciudad por defecto al aceptar.)
    const celdas = filas.map(f => f.celda).filter(Boolean)
    const deCalella = celdas.filter(c => c === CIUDADES.calella.celda)
    expect(deCalella.length, 'ambos dispositivos consultaron Calella').toBeGreaterThanOrEqual(2)
    expect(new Set(deCalella).size, 'una sola celda para esa ciudad').toBe(1)
  })

  test('@api recargar la misma ciudad no infla el recuento de ciudades', async ({ context }) => {
    const marca = nuevaMarca()
    const page = await nuevoVisitante(context)

    await visitanteQueAcepta(page, marca)
    await consultarCiudad(page, CIUDADES.bilbao, marca)
    await consultarCiudad(page, CIUDADES.bilbao, marca)

    const filas = await filasDe(marca)
    const deBilbao = filas.filter(f => f.celda === CIUDADES.bilbao.celda)

    // LA INVARIANTE es que la ciudad no se PARTA: visitada varias veces,
    // una sola celda en el desglose. Si el redondeo o el contexto
    // variaran entre visitas, aparecería como dos entradas distintas.
    //
    // No se exige un número concreto de filas: cuántos pageviews emite el
    // emisor ya lo fija tracking.spec.ts, y atarlo aquí hacía fallar el
    // test bajo carga por un motivo que no es el que comprueba.
    expect(deBilbao.length, 'la ciudad debe registrarse').toBeGreaterThanOrEqual(1)
    expect(new Set(deBilbao.map(f => f.celda)).size, 'una sola celda').toBe(1)
  })

  test('@api las visitas del mismo navegador comparten sesión', async ({ context }) => {
    const marca = nuevaMarca()
    const page = await nuevoVisitante(context)

    await visitanteQueAcepta(page, marca)
    await consultarCiudad(page, CIUDADES.calella, marca)
    await consultarCiudad(page, CIUDADES.sevilla, marca)

    const filas = await filasDe(marca)
    const sesiones = new Set(filas.map(f => f.sesion))

    // Si la sesión rotara en cada petición, "vistas por sesión" y el
    // rebote quedarían pegados a 1 y no significarían nada.
    expect(sesiones.size, 'una visita seguida es UNA sesión').toBe(1)
  })

  test('@api ninguna visita se atribuye a Null Island', async ({ context }) => {
    const marca = nuevaMarca()
    const page = await nuevoVisitante(context)

    // Sin coordenadas en la URL: el caso que producía 0.00,0.00.
    await visitanteQueAcepta(page, marca)
    await page.waitForTimeout(1500)

    const filas = await filasDe(marca)
    expect(filas.length, 'la visita debe registrarse').toBeGreaterThan(0)
    expect(filas.map(f => f.celda)).not.toContain('0.00,0.00')
  })
})
