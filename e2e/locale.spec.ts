import { test, expect } from '@playwright/test'

/**
 * Responde al consentimiento antes de tocar la interfaz.
 *
 * El banner es un diálogo MODAL que bloquea la página hasta que se
 * responde (decisión de producto: sin respuesta no se accede a los
 * datos). Estos tests no van del consentimiento, así que se deja
 * respondido de antemano —RECHAZANDO, para no encender el seguimiento y
 * ensuciar la analítica de las pruebas—. El propio banner tiene sus
 * tests en e2e/consentimiento.spec.ts y components/__tests__.
 */
async function sinBanner(context: import('@playwright/test').BrowserContext) {
  await context.addCookies([
    {
      name: 'wthr_consent',
      value: 'rejected',
      domain: 'localhost',
      path: '/',
    },
  ])
}


/**
 * Rutas por idioma.
 *
 * El idioma vivía sólo en localStorage y `<html lang>` estaba escrito a
 * fuego como "es", corregido después por un efecto de cliente: todo
 * rastreador y todo lector de pantalla veía español, y no existía
 * ninguna URL en inglés que compartir o indexar.
 *
 * Estas pruebas fijan el contrato del esquema de URLs:
 *   español (por defecto)  /            /premium
 *   inglés                 /en          /en/premium
 *
 * OJO con el idioma del NAVEGADOR de prueba: Chromium manda
 * `Accept-Language: en-US` por defecto, y el proxy negocia el idioma para
 * visitantes humanos sin elección previa. Cada bloque fija el suyo
 * explícitamente; si no, la mitad de estas pruebas comprobarían la
 * negociación sin querer en vez de lo que dicen comprobar.
 */

test.describe('esquema de URLs (navegador en español)', () => {
  test.use({ locale: 'es-ES' })

  test('el español no lleva prefijo y las URLs existentes siguen valiendo', async ({ page, context }) => {
  await sinBanner(context)
    await page.goto('/')
    await expect(page).toHaveURL(/\/$/)
    await expect(page.locator('html')).toHaveAttribute('lang', 'es')

    await page.goto('/premium')
    await expect(page).toHaveURL(/\/premium$/)
    await expect(page.locator('html')).toHaveAttribute('lang', 'es')
  })

  test('el inglés se sirve bajo /en con el lang correcto DESDE EL SERVIDOR', async ({ page, context }) => {
  await sinBanner(context)
    // Sin JavaScript de por medio: es lo que ve un rastreador.
    const res = await page.request.get('/en/premium')
    expect(res.status()).toBe(200)
    expect(await res.text()).toContain('lang="en"')
  })

  test('/es/... redirige a la forma canónica sin prefijo', async ({ page, context }) => {
  await sinBanner(context)
    const res = await page.request.get('/es/premium', { maxRedirects: 0 })
    expect(res.status()).toBe(308)
    expect(res.headers()['location']).toContain('/premium')
  })

  test('un idioma inexistente da 404, no una página en español', async ({ page, context }) => {
  await sinBanner(context)
    const res = await page.request.get('/fr/premium')
    expect(res.status()).toBe(404)
  })
})

test.describe('negociación de idioma', () => {
  test.use({ locale: 'en-US' })

  test('un navegador en inglés sin elección previa acaba en /en', async ({ page, context }) => {
  await sinBanner(context)
    await page.goto('/')
    await expect(page).toHaveURL(/\/en$/)
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  })

  test('un bot NUNCA se redirige: ve el sitio en el idioma por defecto', async ({ page, context }) => {
  await sinBanner(context)
    // Googlebot rastrea con Accept-Language: en. Negociar con él le
    // serviría siempre la versión inglesa y le escondería el sitio
    // español, que es el principal.
    const res = await page.request.get('/', {
      maxRedirects: 0,
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' },
    })
    expect(res.status()).toBe(200)
    expect(await res.text()).toContain('lang="es"')
  })
})

test.describe('metadata para buscadores', () => {
  test.use({ locale: 'es-ES' })

  test('cada página declara su propio canonical, no el del layout', async ({ page, context }) => {
  await sinBanner(context)
    // El canonical de un layout se hereda a TODAS sus subpáginas: si
    // estuviera ahí, /cookies declararía que su versión canónica es la
    // portada y quedaría fuera del índice.
    await page.goto('/cookies')
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/cookies$/)
  })

  test('los hreflang enlazan la misma página en los dos idiomas', async ({ page, context }) => {
  await sinBanner(context)
    await page.goto('/en/cookies')
    await expect(page.locator('link[rel="alternate"][hreflang="es"]')).toHaveAttribute('href', /\/cookies$/)
    await expect(page.locator('link[rel="alternate"][hreflang="en"]')).toHaveAttribute('href', /\/en\/cookies$/)
  })

  test('el título y la descripción están traducidos', async ({ page, context }) => {
  await sinBanner(context)
    await page.goto('/cookies')
    await expect(page).toHaveTitle(/Política de cookies/)

    await page.goto('/en/cookies')
    await expect(page).toHaveTitle(/Cookie policy/)
  })
})

test.describe('navegación entre idiomas', () => {
  // El selector de idioma vive en la cabecera MÓVIL (el contenedor de
  // escritorio la oculta con `real-desktop:hidden`), así que a tamaño de
  // escritorio no está en el árbol de accesibilidad y `getByRole` no lo
  // encuentra.
  // Sólo el viewport, no el preset de dispositivo completo: éste trae
  // `defaultBrowserType`, que Playwright no admite dentro de un describe.
  test.use({ viewport: { width: 390, height: 844 }, locale: 'es-ES' })

  test('el selector lleva a la ruta del otro idioma y conserva el estado de la URL', async ({ page, context }) => {
  await sinBanner(context)
    // El query string guarda la ciudad, los modelos y el rango: cambiar
    // de idioma no puede perderlos.
    await page.goto('/?lat=41.4501&lon=2.2478&range=7')
    await page.getByRole('button', { name: 'EN', exact: true }).click()

    await page.waitForURL(/\/en\?/)
    expect(page.url()).toContain('lat=41.4501')
    expect(page.url()).toContain('range=7')
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  })

  test('volver a español quita el prefijo', async ({ page, context }) => {
  await sinBanner(context)
    await page.goto('/en')
    await page.getByRole('button', { name: 'ES', exact: true }).click()

    await page.waitForURL(url => !url.pathname.startsWith('/en'))
    await expect(page.locator('html')).toHaveAttribute('lang', 'es')
  })
})

test.describe('enlaces internos', () => {
  test.use({ locale: 'es-ES' })

  test('conservan el idioma', async ({ page, context }) => {
  await sinBanner(context)
    await page.goto('/en/premium')
    // Sin esto, un enlace `/terms` dentro de la versión inglesa devolvía
    // al visitante al español a mitad de navegación.
    const hrefs = await page.locator('a[href^="/"]').evaluateAll(links =>
      links.map(l => l.getAttribute('href')),
    )
    const internos = hrefs.filter((h): h is string => Boolean(h) && !h!.startsWith('/api'))
    expect(internos.length).toBeGreaterThan(0)
    for (const h of internos) expect(h).toMatch(/^\/en(\/|$)/)
  })
})

test.describe('rutas exentas', () => {
  test.use({ locale: 'es-ES' })

  test('el panel de administración no lleva idioma en la URL', async ({ page, context }) => {
  await sinBanner(context)
    const res = await page.request.get('/admin', { maxRedirects: 0 })
    // Redirige al login por falta de sesión, NO a /es/admin.
    expect(res.headers()['location']).toContain('/admin/login')
  })

  test('robots y sitemap siguen respondiendo', async ({ page, context }) => {
  await sinBanner(context)
    expect((await page.request.get('/robots.txt')).status()).toBe(200)
    expect((await page.request.get('/sitemap.xml')).status()).toBe(200)
  })
})
