import { test, expect } from '@playwright/test'

/**
 * Las páginas en inglés tienen que estar EN INGLÉS.
 *
 * EL FALLO QUE ESTO FIJA. Las cuatro rutas de conversión —/premium,
 * /premium/estaciones, /support, /manage— traducían el `<title>` y la
 * descripción, pero el CUERPO estaba escrito en español dentro del JSX.
 * Peor: las filas de planes se leían siempre por `nameEs` / `labelEs`
 * **aunque la traducción ya existiera** en la base de datos y en
 * `PLAN_FEATURES`. La traducción estaba hecha y no se usaba.
 *
 * Consecuencia práctica: están en el sitemap, así que Google indexaba
 * /en/premium con un título en inglés; quien hacía clic llegaba a la
 * página de pago y no podía leerla. Y /premium/claim, que es el último
 * paso de la compra y se abre desde el email de Stripe, dejaba a quien
 * ACABABA DE PAGAR sin saber qué botón pulsar.
 *
 * El muro de consentimiento tenía el mismo problema y era aún peor: al
 * ser un diálogo bloqueante, era lo primero y lo único que veía un
 * visitante anglófono.
 *
 * Se comprueba buscando cadenas inequívocamente españolas en el texto
 * VISIBLE. No vale con mirar `<html lang>`: eso ya estaba bien y el
 * cuerpo seguía en español.
 */

/** Cadenas que no pueden aparecer en una página inglesa. */
const MARCAS_ESPANOLAS = [
  'Volver',
  'Hazte Premium',
  'Próximamente',
  'Suscripciones desactivadas',
  'Contratar',
  'Apoya el proyecto',
  'Gestionar suscripción',
  'Estado actual',
  'Activo',
  'Inactivo',
  'Activa tu suscripción',
  'Enlace no válido',
  'Reclamar suscripción',
  'Ver planes',
  'Términos',
  'Privacidad',
  'Antes de continuar',
  'Aceptar',
  '¿Qué incluye',
  'Estaciones meteorológicas recomendadas',
]

/**
 * Deja el consentimiento aceptado.
 *
 * El banner es un diálogo modal que bloquea la página hasta responder,
 * así que sin esto no se llegaría al cuerpo de ninguna página. Su
 * versión inglesa se comprueba aparte, más abajo, precisamente porque
 * aquí hay que quitarlo de en medio.
 */
async function sinBanner(context: import('@playwright/test').BrowserContext) {
  await context.addCookies([{ name: 'wthr_consent', value: 'granted', domain: 'localhost', path: '/' }])
}

const RUTAS = [
  '/en/premium',
  '/en/premium/estaciones',
  '/en/premium/claim',
  '/en/support',
  '/en/manage',
]

test.describe('páginas en inglés', () => {
  test.use({ locale: 'en-US' })

  for (const ruta of RUTAS) {
    test(`${ruta} no tiene texto en español`, async ({ page, context }) => {
      await sinBanner(context)
      await page.goto(ruta)
      await expect(page.locator('html')).toHaveAttribute('lang', 'en')

      const texto = (await page.locator('body').innerText()) ?? ''
      const encontradas = MARCAS_ESPANOLAS.filter(m => texto.includes(m))
      expect(
        encontradas,
        `${ruta} muestra texto en español: ${encontradas.join(', ')}\n\n--- cuerpo ---\n${texto.slice(0, 1200)}`,
      ).toEqual([])
    })
  }

  test('el muro de consentimiento se lee en inglés', async ({ page }) => {
    // Sin `sinBanner` a propósito: aquí el diálogo ES lo que se prueba.
    await page.goto('/en')
    const dialogo = page.getByRole('dialog')
    await expect(dialogo).toBeVisible()
    await expect(dialogo).toContainText('Before you continue')
    await expect(page.getByRole('button', { name: 'Accept and continue' })).toBeVisible()
  })
})

test.describe('páginas en español', () => {
  test.use({ locale: 'es-ES' })

  test('siguen en español (el arreglo no las ha volteado)', async ({ page, context }) => {
    // La otra mitad del contrato: al meter el idioma es fácil dejar
    // ambos casos leyendo la misma rama.
    await sinBanner(context)
    await page.goto('/premium')
    await expect(page.locator('html')).toHaveAttribute('lang', 'es')
    await expect(page.getByRole('heading', { name: 'Hazte Premium' })).toBeVisible()
  })
})
