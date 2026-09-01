import { test, expect } from '@playwright/test'

/**
 * En móvil no debe poder hacerse zoom sobre la página.
 *
 * Se comprueba el `<meta name="viewport">` que Next emite a partir del
 * export `viewport` de app/layout.tsx, más el `touch-action` que mata el
 * zoom por doble toque. No se simula un pinch: Playwright no expone
 * gestos de dos dedos, y el navegador ya honra la meta — verificar el
 * contrato emitido es lo que protege de una regresión al editar el
 * layout.
 */

test.describe('zoom bloqueado en móvil', () => {
  test('el meta viewport prohíbe escalar', async ({ page }) => {
    await page.goto('/')

    const content = await page
      .locator('meta[name="viewport"]')
      .getAttribute('content')

    expect(content).toBeTruthy()
    expect(content).toContain('width=device-width')
    expect(content).toContain('initial-scale=1')
    expect(content).toContain('maximum-scale=1')
    expect(content).toContain('user-scalable=no')
  })

  test('html usa touch-action: manipulation (sin zoom por doble toque)', async ({
    page,
  }) => {
    await page.goto('/')

    const touchAction = await page.evaluate(
      () => getComputedStyle(document.documentElement).touchAction,
    )
    expect(touchAction).toBe('manipulation')
  })
})
