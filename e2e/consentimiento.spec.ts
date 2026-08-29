import { test, expect, type Page, type Request } from '@playwright/test'

/**
 * Tasa de aceptación del banner, de punta a punta.
 *
 * Esta métrica cuenta a gente que TODAVÍA NO HA CONSENTIDO, así que lo
 * que se comprueba aquí no es sólo que el número salga: es que la
 * petición no lleve identidad. Si algún día empezara a mandar cookies,
 * dejaría de ser un contador anónimo y pasaría a ser seguimiento sin
 * permiso — en silencio, porque el número seguiría saliendo igual.
 *
 * SE MIDE SOBRE LAS PETICIONES DE LA PROPIA PÁGINA, no sobre el contador
 * de la base. El contador es AGREGADO POR DÍA a propósito (no hay
 * identificador con el que separar a nadie), así que con la suite en
 * paralelo lo incrementan también los otros specs que aceptan el banner:
 * una delta exacta ahí es imposible de afirmar. La primera versión de
 * este fichero lo intentaba y fallaba con "esperaba 1, recibí 3". El
 * "una emisión por carga" se fija en lib/__tests__/consentStats.test.ts.
 *
 * TAMPOCO SE LEE LA BASE desde aquí: hacerlo mientras el servidor escribe
 * daba "database is locked" de SQLite, y no aportaba nada — que la
 * escritura llega y acumula ya lo fija
 * app/api/consent-stats/__tests__/route.test.ts contra SQLite real. Lo
 * que sólo se puede comprobar en un navegador es lo de abajo.
 */

/**
 * Registra las emisiones al contador que hace ESTA página.
 *
 * Se guarda la petición entera para poder leer luego `allHeaders()`, que
 * es asíncrono. `headers()` NO sirve aquí: sólo trae las cabeceras que
 * pone la página, y `Cookie` la añade el navegador en la capa de red. Con
 * `headers()` la comprobación de anonimato pasaba siempre, incluso
 * mandando credenciales a propósito — es decir, no comprobaba nada.
 */
function espiar(page: Page): Request[] {
  const out: Request[] = []
  page.on('request', r => {
    if (new URL(r.url()).pathname.startsWith('/api/consent-stats')) out.push(r)
  })
  return out
}

async function conCookies(peticiones: Request[]): Promise<string[]> {
  const out: string[] = []
  for (const r of peticiones) {
    const h = await r.allHeaders()
    if (h['cookie']) out.push(h['cookie'])
  }
  return out
}

test('@api la impresión y la respuesta se cuentan, y sin cookies', async ({ page }) => {
  const emisiones = espiar(page)

  await page.goto('/')
  const aceptar = page.locator('[data-consent-choice="accept"]').first()
  await expect(aceptar).toBeVisible({ timeout: 25_000 })

  // Una impresión, exactamente una, por esta carga.
  await expect.poll(() => emisiones.length, { timeout: 15_000 }).toBe(1)

  await aceptar.click()
  await expect.poll(() => emisiones.length, { timeout: 15_000 }).toBe(2)

  // LA GARANTÍA DE FONDO: ninguna de las dos lleva identidad. Al pulsar
  // "Aceptar" ya existe `wthr_consent` en el navegador, así que si la
  // petición fuese credencializada esta aserción lo vería.
  expect(
    await conCookies(emisiones),
    'el contador del banner NO puede recibir cookies',
  ).toEqual([])
})

test('@api quien ya respondió no emite nada: sin banner no hay impresión', async ({
  page,
  context,
}) => {
  await page.goto('/')
  await page.locator('[data-consent-choice="accept"]').first().click({ timeout: 25_000 })
  await page.waitForTimeout(1000)

  // Segunda pestaña con la elección ya guardada: el banner no se pinta,
  // así que no puede haber impresión. Si la hubiera, el denominador
  // crecería con gente que nunca vio el banner y la tasa saldría hundida.
  const otra = await context.newPage()
  const emisiones = espiar(otra)
  await otra.goto('/')
  await otra.waitForTimeout(2500)

  expect(emisiones).toEqual([])
})
