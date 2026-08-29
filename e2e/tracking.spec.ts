import { test, expect } from '@playwright/test'

/**
 * El consentimiento es la puerta de TODA la analítica, así que sus dos
 * lados se prueban en un navegador de verdad:
 *
 *   - sin permiso no puede salir ni una petición ni escribirse identidad;
 *   - al aceptar, la visita se cuenta EN EL ACTO.
 *
 * Lo segundo estuvo roto y no lo veía nadie. El tracker comprobaba el
 * permiso en cada emisión pero nada disparaba una emisión al aceptar:
 * sólo emitía al montar, al cambiar la URL y al volver del bfcache. Un
 * visitante nuevo montaba sin permiso (no emite), aceptaba (nadie
 * escucha) y se iba sin contarse. En una app que se usa en una sola
 * carga de página, eso es casi todo el mundo.
 */

const HOME = '/?lat=41.3874&lon=2.1686'

async function esperarIngesta(page: import('@playwright/test').Page, ms = 8000) {
  return page
    .waitForRequest(r => new URL(r.url()).pathname === '/api/ingest', { timeout: ms })
    .then(() => true)
    .catch(() => false)
}

/**
 * Espera a que React haya adoptado el árbol.
 *
 * Antes se esperaba a un `/api/forecast` con 200, y eso ataba estos tests
 * a un proveedor externo: bajo carga (la suite entera en paralelo) la
 * previsión tarda o devuelve 429 y el test caía por un motivo que no
 * tiene nada que ver con lo que comprueba. La hidratación es lo que de
 * verdad hace falta —que AnalyticsTracker esté montado y su emit inicial
 * ya haya salido de vacío— y no depende de la red.
 */
async function esperarHidratacion(page: import('@playwright/test').Page) {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const el = document.querySelector('[data-consent-dialog]') ?? document.querySelector('main')
          return !!el && Object.keys(el).some(k => k.startsWith('__react'))
        }),
      { timeout: 25_000 },
    )
    .toBe(true)
}

test('sin consentimiento no se emite nada ni se acuña identidad', async ({ page, context }) => {
  await page.goto(HOME)
  await esperarHidratacion(page)

  expect(await esperarIngesta(page, 3000), 'no debe salir ninguna ingesta').toBe(false)

  const nombres = (await context.cookies()).map(c => c.name)
  expect(nombres, 'sin permiso no se acuña anon_id').not.toContain('wthr_anon')
})

test('aceptar cuenta la visita sin recargar', async ({ page, context }) => {
  await page.goto(HOME)
  await esperarHidratacion(page)

  const aceptar = page.locator('[data-consent-choice="accept"]').first()
  await expect(aceptar).toBeVisible({ timeout: 10_000 })

  // ESPERA IMPRESCINDIBLE, y no es por lentitud. Mientras el estado se
  // asienta, la app reescribe la URL varias veces; cada reescritura
  // dispara una emisión diferida. Si se pulsa "Aceptar" dentro de esa
  // ventana, ESE emit —no el del consentimiento— manda el pageview, y el
  // test pasa en verde aunque el aviso de consentimiento no exista. Se
  // comprobó: quitando el listener, la versión sin esta espera seguía
  // pasando. Hay que dejar que la URL se quede quieta para que la única
  // causa posible de una emisión sea aceptar.
  const urlAntes = page.url()
  await page.waitForTimeout(2500)
  expect(page.url(), 'la URL debe haberse asentado antes de pulsar').toBe(urlAntes)

  const ingesta = page.waitForRequest(r => new URL(r.url()).pathname === '/api/ingest', {
    timeout: 15_000,
  })
  await aceptar.click()

  // LA ASERCIÓN QUE IMPORTA: sin recargar, sin navegar. Antes había que
  // volver a cargar el documento para que se contara algo.
  await ingesta

  // Y la identidad se acuña en la respuesta de esa misma petición, para
  // que la visita no quede huérfana.
  await expect
    .poll(async () => (await context.cookies()).map(c => c.name), { timeout: 10_000 })
    .toContain('wthr_anon')
})

test('la portada sin coordenadas en la URL no se atribuye a Null Island', async ({ page }) => {
  // `useUrlState` omite lat/lon cuando son los de la ciudad por defecto.
  // `Number(null)` es 0 y el guard lo daba por válido, así que esas
  // visitas se grababan en la celda 0.00,0.00 —mitad del Atlántico— y
  // "océano Atlántico" acabó siendo la ubicación más consultada.
  //
  // El payload se captura envolviendo `sendBeacon` y NO con
  // `request.postData()`: el beacon manda un Blob, cuyo cuerpo Playwright
  // no expone. Leyéndolo de ahí, la aserción salía vacía y el test pasaba
  // sin comprobar nada.
  await page.addInitScript(() => {
    const w = window as unknown as { __pv: string[] }
    w.__pv = []
    const original = navigator.sendBeacon?.bind(navigator)
    if (!original) return
    navigator.sendBeacon = (url: string | URL, data?: BodyInit | null): boolean => {
      try {
        if (String(url).includes('/api/ingest') && data instanceof Blob) {
          data.text().then(t => { w.__pv.push(t) })
        }
      } catch { /* no debe alterar el envío real */ }
      return original(url, data)
    }
  })

  await page.goto('/')
  const aceptar = page.locator('[data-consent-choice="accept"]').first()
  await expect(aceptar).toBeVisible({ timeout: 15_000 })
  await aceptar.click()

  // Se espera al PAYLOAD, no a la petición: `waitForRequest` registrado
  // después del clic se pierde el beacon, que sale en el acto.
  const leer = () => page.evaluate(() => (window as unknown as { __pv: string[] }).__pv)
  await expect.poll(leer, { timeout: 15_000 }).not.toHaveLength(0)
  const payloads = await leer()

  // Se comprueba que la captura funciona antes de fiarse de la aserción:
  // una lista vacía haría pasar el filtro de abajo sin probar nada.
  expect(payloads.join(''), 'el payload capturado debe ser un pageview').toContain('"k":"pv"')
  const nullIsland = payloads.filter(b => /"lat":0(\.0+)?,"lon":0(\.0+)?/.test(b))
  expect(nullIsland, `payloads con 0,0: ${JSON.stringify(payloads)}`).toHaveLength(0)
})
