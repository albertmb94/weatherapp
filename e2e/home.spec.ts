import { test, expect } from '@playwright/test'

// B-NBT-4 (2026-08-22): the old specs waited for a "Multi-model
// comparison" heading that was renamed to "Insights" (insightsTitle)
// several sprints ago, so they had been failing ever since. They now
// pin the current UI and cover the model selector end-to-end.

test('home renders with the city search input', async ({ page }) => {
  await page.goto('/')
  // Mobile + desktop headers each render a search input; role locators
  // only match the accessibility tree, i.e. the visible one.
  await expect(page.getByRole('textbox', { name: /Search|Buscar/i })).toBeVisible()
  // The Insights table renders once the forecast query resolves.
  await expect(page.getByTestId('insights-table')).toBeVisible({ timeout: 20_000 })
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
  await expect(page.getByTestId('insights-table')).toBeVisible({ timeout: 20_000 })
  expect(errors).toEqual([])
})

test('model selector lists every land model and switching works', async ({ page }) => {
  await page.goto('/?lat=41.45&lon=2.2475')
  await expect(page.getByTestId('insights-table')).toBeVisible({ timeout: 20_000 })
  // Switch the advanced section into Models mode.
  await page.getByRole('button', { name: 'Models', exact: true }).first().click()
  // Open the model dropdown (label is "All" when everything is selected).
  await page.getByRole('button', { name: /^(All|\d+ models?)$/ }).click()
  // 19 land models are selectable (marine only appears with marine=1).
  await expect(page.getByTestId('model-option')).toHaveCount(19)
  // Regional high-res models must be among them (B-NEW-41).
  const labels = ['AROME-FR 1.3km', 'ICON-D2 2km', 'ARPEGE-EU 10km', 'ICON-EU 7km']
  for (const label of labels) {
    await expect(page.getByTestId('model-option').filter({ hasText: label })).toHaveCount(1)
  }
})
