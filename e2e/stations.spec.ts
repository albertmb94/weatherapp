import { test, expect } from '@playwright/test'

test('stations tab loads for a Spanish city', async ({ page }) => {
  await page.goto('/?lat=41.45&lon=2.2475')
  // El banner se monta DESPUÉS de hidratar (nunca en el HTML del
  // servidor), así que hay que esperarlo: un `isVisible()` inmediato
  // devuelve false y el clic siguiente choca contra el diálogo cuando por
  // fin aparece.
  //
  // Ahora hay que ACEPTAR, no rechazar: el diálogo es un muro y sólo
  // aceptar lo cierra. Este test antes rechazaba, y con el muro se
  // quedaba bloqueado esperando una tabla detrás del modal.
  const aceptar = page.locator('[data-consent-choice="accept"]').first()
  await aceptar.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {})
  if (await aceptar.isVisible().catch(() => false)) {
    await aceptar.click()
    await aceptar.waitFor({ state: 'detached', timeout: 5_000 }).catch(() => {})
  }
  await page.getByRole('button', { name: /Estaciones|Stations/i }).click()
  // Either AEMET or Meteoclimatic must report at least one station.
  await expect(page.locator('.grid').first()).toBeVisible({ timeout: 15_000 })
})

test('short link roundtrip', async ({ page, request }) => {
  await page.goto('/?lat=41.45&lon=2.2475&metric=temperature')
  const res = await request.post('/api/shorten', {
    data: { params: 'lat=41.45&lon=2.2475&metric=temperature' },
  })
  expect(res.ok()).toBeTruthy()
  const body = await res.json()
  expect(body.id).toMatch(/^[a-z0-9]{8}$/)
  const redirect = await request.get(`/s/${body.id}`, { maxRedirects: 0 })
  expect([301, 302, 307, 308]).toContain(redirect.status())
})