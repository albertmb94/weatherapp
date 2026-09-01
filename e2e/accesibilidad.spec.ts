import { test, expect } from '@playwright/test'

/**
 * Navegación por teclado.
 *
 * LO QUE SE PROTEGE AQUÍ:
 *
 *  - **Enlace de salto.** No existía. Llegar al contenido con teclado
 *    obligaba a atravesar la cabecera entera —buscador, selectores de
 *    modelo, menú— en CADA carga, y la tabla de comparación tiene 336
 *    filas enfocables detrás.
 *  - **Foco visible.** No había ningún estilo de foco global: algunos
 *    componentes traían el suyo y el resto dependía del anillo por
 *    defecto del navegador, que sobre fondo oscuro no se ve. Tabular por
 *    336 filas sin saber dónde estás es avanzar a ciegas.
 *  - **La tabla sigue siendo una tabla.** Las filas llevaban
 *    `role="button"`, que las saca del árbol de accesibilidad COMO FILA
 *    y desasocia cada celda de su cabecera.
 */

async function sinBanner(context: import('@playwright/test').BrowserContext) {
  await context.addCookies([{ name: 'wthr_consent', value: 'granted', domain: 'localhost', path: '/' }])
}

test.describe('accesibilidad de teclado', () => {
  test.use({ locale: 'es-ES' })

  test('el enlace de salto es lo primero que recibe el foco y lleva al contenido', async ({ page, context }) => {
    await sinBanner(context)
    await page.goto('/')

    await page.keyboard.press('Tab')

    const enfocado = page.locator(':focus')
    await expect(enfocado).toHaveText(/Saltar al contenido/i)
    // Oculto hasta recibir foco, pero visible en cuanto lo tiene: si
    // estuviera con `display:none` no sería tabulable, y si estuviera
    // siempre visible sería un elemento suelto en la esquina.
    await expect(enfocado).toBeVisible()

    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/#contenido$/)

    // Y el foco tiene que MOVERSE de verdad. Sin `tabIndex={-1}` en el
    // destino, el navegador desplaza el scroll pero deja el foco donde
    // estaba, así que el siguiente Tab volvería a la cabecera y el
    // enlace no serviría para nada.
    const idDestino = await page.evaluate(() => document.activeElement?.id ?? '')
    expect(idDestino).toBe('contenido')
  })

  test('los elementos enfocables tienen anillo de foco visible', async ({ page, context }) => {
    await sinBanner(context)
    await page.goto('/')
    await page.keyboard.press('Tab')

    const contorno = await page.evaluate(() => {
      const el = document.activeElement
      if (!el) return null
      const cs = getComputedStyle(el)
      return { width: cs.outlineWidth, style: cs.outlineStyle }
    })
    expect(contorno).not.toBeNull()
    expect(contorno!.style).not.toBe('none')
    expect(parseFloat(contorno!.width)).toBeGreaterThan(0)
  })

  test('ninguna fila de la tabla se disfraza de botón', async ({ page, context }) => {
    await sinBanner(context)
    await page.goto('/?lat=41.3874&lon=2.1686')

    // La tabla depende del pronóstico, que viaja a un proveedor externo.
    // Con la suite entera en paralelo esto se va a bastante más de lo que
    // tarda en solitario, así que el margen es amplio A PROPÓSITO: un
    // test de accesibilidad que falla por lentitud de red se acaba
    // ignorando, y entonces deja de proteger nada.
    await expect
      .poll(() => page.locator('tbody tr').count(), { timeout: 60_000 })
      .toBeGreaterThan(0)

    const disfrazadas = await page.locator('tr[role="button"]').count()
    expect(disfrazadas, 'role="button" en un <tr> desasocia cada celda de su cabecera').toBe(0)

    // Y los controles de paginación, cuando existen, son botones de verdad.
    const cta = page.locator('[data-testid="next-page-cta"]')
    if (await cta.count()) {
      expect(await cta.first().evaluate(el => el.tagName.toLowerCase())).toBe('button')
    }
  })
})
