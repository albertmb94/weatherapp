import { defineConfig, devices } from '@playwright/test'

// M-ROB-1: Playwright config for E2E tests.
//
// AUDITORÍA — dos cambios:
//
//  1. El servidor era `npm run dev`. Un build de desarrollo NO ejercita
//     el service worker, ni los chunks con hash, ni los route handlers
//     `force-static`, ni la minificación — es decir, precisamente las
//     zonas donde estaban los fallos P0 de esta auditoría. Los E2E
//     pasaban en verde sobre un artefacto que no es el que se despliega.
//     Se puede volver al modo rápido con E2E_DEV=1 para iterar en local.
//
//  2. Sólo había un proyecto Chromium de escritorio, pese a que la app
//     tiene ramas específicas de móvil por todas partes (MobileTabBar,
//     las variantes `real-desktop:`, el colapso de cabecera). El
//     comportamiento móvil no lo cubría nadie.
const useDevServer = process.env.E2E_DEV === '1'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Tope de concurrencia, y no por lentitud de la máquina: los tests
  // comparten UN servidor, UNA base SQLite y un proveedor externo con
  // límite de peticiones. Sin tope, Playwright abre tantos workers como
  // núcleos y la suite fallaba de forma distinta en cada pasada —
  // Open-Meteo devolviendo 429, o escrituras de analítica pisándose.
  // Tests que fallan por contención enseñan a ignorar el rojo.
  workers: process.env.CI ? 1 : 4,
  reporter: 'list',
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'] },
      // Los tests marcados @api no tocan la interfaz: repetirlos aquí no
      // prueba nada nuevo y, al correr en paralelo con el proyecto de
      // escritorio contra el MISMO servidor, agotaban el límite por IP de
      // los endpoints con rate limit y fallaban de forma intermitente.
      grepInvert: /@api/,
    },
  ],
  webServer: {
    command: useDevServer ? 'npm run dev' : 'npm run build && npm run start',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    // El build de producción tarda bastante más que arrancar el dev.
    timeout: useDevServer ? 60_000 : 300_000,
    env: {
      // SIN ESTO NO HAY BASE DE DATOS. `lib/db.ts` anula el cliente cuando
      // NODE_ENV=production y no hay TURSO_DATABASE_URL, porque el sistema
      // de ficheros de una función serverless es de sólo lectura. En un
      // servidor de pruebas local eso deja sin datos a TODO lo que
      // dependa de la BD (enlaces cortos, planes, feature flags), y los
      // tests fallan con 404 en vez de con un error claro. El flag existe
      // precisamente para "modo producción fuera de serverless".
      DB_ALLOW_FILE_IN_PRODUCTION: '1',
      // Necesario para que el proxy registre el arranque de sesión; sin
      // él esa parte de la analítica queda muda en las pruebas.
      TRACK_INTERNAL_SECRET: 'e2e-secreto-local',
    },
  },
})
