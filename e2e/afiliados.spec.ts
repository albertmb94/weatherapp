import { test, expect } from '@playwright/test'

/**
 * Guarda del slot patrocinado (Amazon).
 *
 * POR QUÉ EXISTE
 *
 * Este fallo ha aparecido DOS veces, y las dos con el mismo síntoma: hay
 * productos activos en el catálogo, /api/affiliates/serve los devuelve, y
 * aun así en la portada no sale nada. Las dos veces la causa fue la
 * misma: alguien añadió un gate delante del componente.
 *
 *   - B-NBT-14 quitó el gate `feature.affiliates` a propósito, por ser
 *     una segunda superficie de control redundante ("he añadido el
 *     producto y no sale"). EL CONTROL SON LOS PRODUCTOS.
 *   - Una auditoría posterior vio la variable `affiliatesEnabled`
 *     calculada y sin usar, la interpretó como un descuido y la volvió a
 *     cablear — reproduciendo el fallo exacto que B-NBT-14 evitaba. Se
 *     corrigió en 96f89a5.
 *
 * El test unitario de SponsoredSection cubre el componente aislado, pero
 * no ve el cableado desde FriendlyHome, que es justo donde se rompió.
 *
 * LA INVARIANTE, no los datos: si el catálogo tiene producto para los
 * tres slots, entonces —sea cual sea el que toque por hora local y
 * lluvia— la portada TIENE que mostrar un enlace de afiliado. Con el
 * catálogo vacío no hay nada que comprobar y el test se salta, en vez de
 * fallar por el motivo equivocado.
 *
 * OJO AL ESCRIBIRLO: la primera versión deducía si había producto
 * espiando la petición que hace la propia página. Eso no servía: al
 * reintroducir el gate, la página no llega ni a pedirlo, así que el test
 * se SALTABA en lugar de fallar — precisamente ante la regresión que
 * viene a cazar. Por eso el catálogo se consulta por separado, con
 * `request`, sin pasar por la página.
 */
const SLOTS = ['slot_uv', 'slot_rain', 'slot_sunset'] as const

test('@api si hay catálogo, la portada muestra el enlace de afiliado', async ({ page, request }) => {
  const productos = await Promise.all(
    SLOTS.map(async slot => {
      const r = await request.get(`/api/affiliates/serve?trigger=${slot}&locale=es`)
      if (!r.ok()) return null
      return (await r.json())?.product ?? null
    }),
  )
  test.skip(
    productos.some(p => p === null),
    'el catálogo de pruebas no cubre los tres slots: no se puede saber cuál toca',
  )

  await page.goto('/?lat=41.45&lon=2.2475')
  await page.waitForResponse(
    r => new URL(r.url()).pathname === '/api/forecast' && r.status() === 200,
    { timeout: 25_000 },
  )

  // `pickActiveSlot` siempre devuelve uno de los tres una vez hay
  // previsión cargada, así que con catálogo completo el enlace es
  // obligatorio. Sin espera fija: se deja que el locator reintente.
  const enlace = page.locator('a[href*="/api/affiliate/redirect"]').first()
  await expect(
    enlace,
    'hay producto activo para los tres slots pero la portada no muestra ningún enlace: ¿alguien ha vuelto a poner un gate delante de SponsoredSection?',
  ).toBeVisible({ timeout: 15_000 })

  const ids = productos.map(p => p!.id)
  const href = (await enlace.getAttribute('href')) ?? ''
  expect(ids.some(id => href.includes(`product_id=${id}`))).toBe(true)
  // Google exige marcar los enlaces de pago como patrocinados.
  await expect(enlace).toHaveAttribute('rel', /sponsored/)
})
