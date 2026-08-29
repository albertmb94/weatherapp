import { test, expect } from '@playwright/test'

/**
 * Prueba de humo de HIDRATACIÓN.
 *
 * POR QUÉ EXISTE
 *
 * Los 52 E2E anteriores pasaban en verde sobre una app que no hidrataba:
 * todos comprobaban ESTRUCTURA (que existiera el encabezado, la tabla, el
 * pie), y la estructura la pinta el servidor. Si React nunca adopta el
 * HTML no corre ningún efecto ni ninguna consulta, así que la página se ve
 * completa pero con todos los valores a guiones y sin una sola petición a
 * /api — y ninguna aserción de estructura se entera.
 *
 * Este fichero comprueba lo contrario: que el cliente está VIVO. Son las
 * dos señales que ningún render de servidor puede falsificar.
 *
 * OJO AL MEDIRLO A MANO: la portada cuelga de un <Suspense> que se sirve
 * en diferido (`<template id="B:0">` + el script `$RC`). React programa la
 * revelación de ese límite con `requestAnimationFrame`, que NO dispara en
 * una pestaña que no compone frames (headless sin pintar, pestaña de
 * fondo, panel oculto). En esos entornos la página se queda con el
 * marcador `$~` (SUSPENSE_QUEUED_START_DATA) para siempre y parece rota
 * sin estarlo. Playwright sí compone, por eso la comprobación vive aquí y
 * no en un script suelto.
 */

const PORTADA = '/en?lat=41.45&lon=2.2475'

test.use({ locale: 'en-US' })

test('la portada hidrata y pide datos de verdad', async ({ page }) => {
  const peticiones: string[] = []
  page.on('request', r => {
    const u = new URL(r.url())
    if (u.pathname.startsWith('/api/')) peticiones.push(u.pathname)
  })

  await page.goto(PORTADA)

  // Señal 1: el cliente hace la petición de previsión. La emite un efecto
  // de react-query, así que sólo puede ocurrir si React adoptó el árbol.
  //
  // Se espera la PETICIÓN, no un 200. Lo que demuestra la hidratación es
  // que el cliente la haga; el código de respuesta depende de Open-Meteo,
  // que bajo carga (la suite entera en paralelo) devuelve 429 y hacía
  // fallar el test por un motivo ajeno a lo que comprueba.
  await page.waitForRequest(
    r => new URL(r.url()).pathname === '/api/forecast',
    { timeout: 25_000 },
  )
  expect(peticiones).toContain('/api/forecast')

  // Señal 2: el límite Suspense quedó revelado. Si sigue en `$~` o en
  // `$?`, el contenido está en el DOM pero React no lo ha adoptado.
  const marcadores = await page.evaluate(() => {
    const it = document.createNodeIterator(document.documentElement, NodeFilter.SHOW_COMMENT)
    const out: string[] = []
    let n: Node | null
    while ((n = it.nextNode())) {
      const v = n.nodeValue ?? ''
      if (v.startsWith('$')) out.push(v)
    }
    return out
  })
  expect(marcadores, 'ningún límite Suspense puede quedar pendiente').not.toContain('$~')
  expect(marcadores, 'ningún límite Suspense puede quedar pendiente').not.toContain('$?')

  // Señal 3: React adoptó los nodos del interior del límite. La clave
  // interna `__react*` sólo la escribe la hidratación.
  const adoptado = await page.evaluate(() => {
    const el = document.querySelector('main') ?? document.body.firstElementChild
    return !!el && Object.keys(el).some(k => k.startsWith('__react'))
  })
  expect(adoptado, 'React debe adoptar el árbol servido').toBe(true)
})

test('@api la portada acaba mostrando una temperatura, no guiones', async ({ page }) => {
  await page.goto(PORTADA)

  // Sin esperar a un 200 concreto: la aserción de abajo ya exige que el
  // dato esté PINTADO, y da igual si vino de la red o de la caché — en
  // ambos casos significa que el cliente está vivo y los datos llegaron.
  // Atarlo a un 200 de Open-Meteo sólo añadía fragilidad.
  await expect(page.getByText(/-?\d+\s*°/).first()).toBeVisible({ timeout: 30_000 })
})
