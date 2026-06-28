import { test, expect } from '@playwright/test'

test('home renders with the city search input', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByPlaceholder(/Search|Buscar/i)).toBeVisible()
  // The Multi-model comparison heading appears once the chart has rendered.
  await expect(page.getByText(/Multi-model comparison/i)).toBeVisible({ timeout: 15_000 })
})

test('URL search params drive the forecast view', async ({ page }) => {
  await page.goto('/?lat=41.45&lon=2.2475&metric=temperature&range=24')
  await expect(page).toHaveURL(/lat=41\.45/)
  await expect(page).toHaveURL(/metric=temperature/)
})

test('invalid metric in URL is ignored (no crash)', async ({ page }) => {
  // B-NEW: A3 regression. ?metric=foo must not throw.
  const errors: string[] = []
  page.on('pageerror', e => errors.push(String(e)))
  await page.goto('/?metric=__bogus__')
  await expect(page.getByText(/Multi-model comparison/i)).toBeVisible({ timeout: 15_000 })
  expect(errors).toEqual([])
})