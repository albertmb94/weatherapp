import { test, expect } from '@playwright/test'

/**
 * El mapa de estaciones no puede depender de un proveedor con clave.
 *
 * Se usaba el estilo `dark_all` de CARTO. CARTO cambió sus condiciones y
 * esa ruta pasó a exigir clave de API: el mapa seguía cargando, así que
 * ningún test lo notó, pero salía con una marca de agua "API KEY
 * REQUIRED" encima. Es el fallo peor de detectar — nada peta, nada
 * aparece en consola, y sólo se ve mirando.
 *
 * Este test mira: de qué host vienen las teselas, que carguen de verdad,
 * y que la atribución de OpenStreetMap esté presente (es obligatoria por
 * la licencia ODbL, no decorativa).
 */

const PROVEEDORES_CON_CLAVE = [
  'cartocdn.com',
  'mapbox.com',
  'stadiamaps.com',
  'maptiler.com',
  'thunderforest.com',
  'here.com',
  'googleapis.com',
]

test('@api las teselas vienen de un proveedor sin clave y con atribución', async ({ page }) => {
  const hosts = new Set<string>()
  page.on('request', r => {
    const u = new URL(r.url())
    if (/\/\d+\/\d+\/\d+(@\dx)?\.(png|jpg|webp|pbf)/.test(u.pathname)) hosts.add(u.hostname)
  })

  await page.goto('/?lat=41.3874&lon=2.1686')
  const aceptar = page.locator('[data-consent-choice="accept"]').first()
  if (await aceptar.count()) await aceptar.click().catch(() => {})

  await page.getByRole('button', { name: /stations|estaciones/i }).first().click({ timeout: 25_000 })
  await expect(page.locator('.leaflet-container').first()).toBeVisible({ timeout: 25_000 })

  // Que las teselas CARGUEN, no sólo que se pidan: un 401 del proveedor
  // dejaría el mapa gris y este test en verde.
  await expect
    .poll(() => page.locator('.leaflet-tile-loaded').count(), { timeout: 25_000 })
    .toBeGreaterThan(0)

  const listaHosts = [...hosts]
  expect(listaHosts.length, `no se pidió ninguna tesela: ${JSON.stringify(listaHosts)}`).toBeGreaterThan(0)
  for (const h of listaHosts) {
    for (const malo of PROVEEDORES_CON_CLAVE) {
      expect(h, `${h} exige clave de API`).not.toContain(malo)
    }
  }

  // Obligatoria por la licencia de los datos.
  const atribucion = await page.locator('.leaflet-control-attribution').first().textContent()
  expect(atribucion ?? '').toContain('OpenStreetMap')
})

test('@api el mapa se oscurece con el tema, sin cambiar de proveedor', async ({ page }) => {
  // Las teselas de OSM sólo existen en claro; el aspecto oscuro es un
  // filtro CSS. Se aplica SÓLO al panel de teselas: si alcanzara a los
  // marcadores, las chinchetas de estaciones saldrían en negativo.
  await page.goto('/?lat=41.3874&lon=2.1686')
  const aceptar = page.locator('[data-consent-choice="accept"]').first()
  if (await aceptar.count()) await aceptar.click().catch(() => {})

  await page.getByRole('button', { name: /stations|estaciones/i }).first().click({ timeout: 25_000 })
  await expect(page.locator('.leaflet-container').first()).toBeVisible({ timeout: 25_000 })

  const estilos = await page.evaluate(() => {
    const raiz = document.documentElement
    const pane = document.querySelector('.leaflet-tile-pane')
    const marcador = document.querySelector('.leaflet-marker-pane')
    return {
      temaClaro: raiz.classList.contains('light'),
      teselas: pane ? getComputedStyle(pane).filter : null,
      marcadores: marcador ? getComputedStyle(marcador).filter : null,
    }
  })

  if (estilos.temaClaro) {
    expect(estilos.teselas === 'none' || estilos.teselas === null).toBe(true)
  } else {
    expect(String(estilos.teselas)).toContain('invert')
  }
  expect(estilos.marcadores === 'none' || estilos.marcadores === null).toBe(true)
})
