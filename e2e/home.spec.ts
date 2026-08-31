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

// The search input carried a hard-coded `id="city-search-input"` while
// CitySearch mounts twice (mobile header + sticky desktop header), so the
// page shipped two elements sharing an id. Every `getElementById` lookup
// resolved to the first one — the mobile input, hidden on desktop — and
// the × button sent focus to an invisible element. Found while writing
// these specs: `page.locator('#city-search-input').first()` resolved to
// the hidden input and failed with "Received: hidden".
test('the home page has no duplicate element ids', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('insights-table')).toBeVisible({ timeout: 20_000 })

  // Pin the premise: both headers really do render a search input, so
  // the assertion below is not passing for want of a second instance.
  await expect(page.locator('[data-city-search-input]')).toHaveCount(2)

  const duplicates = await page.evaluate(() => {
    const counts = new Map<string, number>()
    for (const el of document.querySelectorAll('[id]')) {
      counts.set(el.id, (counts.get(el.id) ?? 0) + 1)
    }
    return [...counts].filter(([, n]) => n > 1).map(([id, n]) => `${id} ×${n}`)
  })
  expect(duplicates).toEqual([])
})

// Runs in both projects, so it covers the desktop header (where the bug
// showed) and the mobile one. A single character keeps the geocode query
// disabled (it needs 2+), so the × can't be swapped for the spinner
// mid-test.
test('the clear button returns focus to the visible search input', async ({ page }) => {
  await page.goto('/')
  const input = page.getByRole('textbox', { name: /Search|Buscar/i })
  await expect(input).toBeVisible()

  await input.fill('B')
  const clear = page.getByTestId('city-search-clear')
  await expect(clear).toHaveCount(1)
  await clear.click()

  await expect(input).toHaveValue('')
  await expect(input).toBeFocused()
})
