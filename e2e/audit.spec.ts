import { test, expect } from '@playwright/test'

test('forecast typography and daily cards remain readable', async ({ page, context }) => {
  await context.addCookies([{ name: 'wthr_consent', value: 'granted', domain: 'localhost', path: '/' }])
  await page.route('**/api/aemet?*', route => route.fulfill({ json: { stations: [] } }))
  await page.route('**/api/meteocat?*', route => route.fulfill({ json: { stations: [] } }))
  await page.goto('/')
  const card = page.getByRole('region', { name: /Tiempo actual|Current weather/ })
  const temperature = card.locator('span.text-6xl')
  await expect(temperature).toBeVisible()
  expect(await temperature.evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(48)
  await expect(page.getByTestId('daily-card').first()).toBeVisible({ timeout: 30_000 })
  expect(await page.getByTestId('daily-card').first().evaluate(el => el.getBoundingClientRect().width)).toBeGreaterThanOrEqual(70)
  // No fresh stations: the fallback ensemble must not be labelled live station.
  await expect(card.getByText(/EN VIVO.*ESTACIÓN|LIVE.*STATION/i)).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: test.info().outputPath('forecast.png'), fullPage: true })
})
