import { test, expect } from '@playwright/test'

// B-NBT-? (auditoría F5): cobertura E2E de flujos de monetización/legal
// que antes no tenían specs. Solo happy-paths que no dependen de credenciales
// reales ni de Stripe/Resend en vivo.

test('admin login page renders the native form', async ({ page }) => {
  await page.goto('/admin/login')
  await expect(page.getByRole('heading', { name: /Weather Admin/i })).toBeVisible()
  await expect(page.getByPlaceholder('Usuario')).toBeVisible()
  await expect(page.getByPlaceholder('Contraseña')).toBeVisible()
})

test('admin area redirects to login without a session', async ({ page }) => {
  // Sin cookie wthr_admin el proxy redirige a /admin/login.
  await page.goto('/admin')
  await expect(page).toHaveURL(/\/admin\/login/)
})

// @api — estos dos no tocan la interfaz, así que no aportan nada
// repetidos en el proyecto móvil; y como /api/newsletter/subscribe está
// limitado a 3/min POR IP, ejecutarlos en dos proyectos a la vez hacía
// que el segundo recibiera un 429 y fallara de forma intermitente.
test('newsletter rejects a malformed email (double opt-in validation) @api', async ({ request }) => {
  const res = await request.post('/api/newsletter/subscribe', {
    data: { email: '@@@not-an-email' },
  })
  expect(res.status()).toBe(400)
  const body = await res.json()
  expect(body.error).toBe('invalid_email')
})

test('newsletter subscribe returns pending (no Resend needed) @api', async ({ request }) => {
  const email = `e2e-${Date.now()}@example.com`
  const res = await request.post('/api/newsletter/subscribe', {
    data: { email },
  })
  // /api/newsletter/subscribe está limitado a 3/min POR IP, y el límite
  // vive en memoria del proceso: dos ejecuciones seguidas de la suite
  // dentro del mismo minuto agotan el cupo. Se acepta el 429 como
  // resultado VÁLIDO —es el comportamiento correcto del endpoint— pero
  // sin dejar de comprobar el camino bueno cuando hay cupo.
  const body = await res.json()
  if (res.status() === 429) {
    expect(body.error).toBe('rate_limited')
    return
  }
  expect(res.ok()).toBeTruthy()
  // Sin Resend configurado el email no se envía, pero la suscripción queda
  // pendiente (double opt-in) y la API responde ok.
  expect(body.pending).toBe(true)
  expect(body.message).toMatch(/email/i)
})

test('manage page renders subscription status', async ({ page }) => {
  await page.goto('/manage')
  await expect(page.getByRole('heading', { name: /Gestionar suscripción/i })).toBeVisible()
})

test('legal pages render', async ({ page }) => {
  for (const path of ['/cookies', '/privacy', '/terms', '/affiliate-disclosure']) {
    await page.goto(path)
    // Cualquier heading significa que la página renderizó.
    await expect(page.locator('h1, h2').first()).toBeVisible()
  }
})

test('premium page lists plans', async ({ page }) => {
  await page.goto('/premium')
  await expect(page.getByRole('heading', { name: /Premium/i }).first()).toBeVisible()
})
