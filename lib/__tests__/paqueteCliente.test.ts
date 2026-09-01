import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, readdirSync, statSync } from 'fs'
import { join, dirname, resolve, sep } from 'path'

/**
 * Ningún componente de cliente puede alcanzar el módulo de base de datos.
 *
 * EL FALLO QUE ESTO FIJA, y por qué hacía falta un test. `home-content`
 * (que es `'use client'`) importaba `getModelAccuracyByTerrain`, y
 * `useEntitlements` importaba la constante `FREE_ENTITLEMENTS`. Los dos
 * caminos terminaban en `lib/db.ts` → `@libsql/client`, que se empaquetó
 * para el navegador: 493 KB crudos, el 36% del JS de primera carga.
 *
 * Lo grave no era el peso, era que ESE CÓDIGO NO PODÍA FUNCIONAR. En el
 * navegador `TURSO_DATABASE_URL` no existe —no lleva prefijo
 * `NEXT_PUBLIC_`, así que nunca se inlinea— y `getDb()` devolvía null
 * siempre. La recomendación de modelos por terreno llevaba desactivada
 * en producción desde que se escribió.
 *
 * Y era indetectable a ojo: el modo degradado (conjunto de modelos
 * vacío, ensemble sin ajustar) es idéntico al caso legítimo de "el
 * backtest todavía no ha escrito filas para este terreno". No petaba
 * nada, no salía nada en consola. Sólo se ve mirando el paquete.
 *
 * La trampa concreta a recordar: **importar un TIPO es gratis, importar
 * un VALOR del mismo módulo lo arrastra entero**. `FREE_ENTITLEMENTS`
 * era una constante de tres líneas y metía medio megabyte. Por eso los
 * datos y tipos compartidos viven en ficheros `*.catalog.ts` sin
 * importaciones de servidor.
 */

const RAIZ = resolve(__dirname, '..', '..')
const EXTS = ['.ts', '.tsx', '.js', '.jsx']
const IGNORAR = new Set(['node_modules', '.next', '.git', 'e2e', 'scripts'])

/** El módulo prohibido y todo lo que lo delata. */
const PROHIBIDOS = ['lib/db.ts']

function listar(dir: string, out: string[] = []): string[] {
  for (const entrada of readdirSync(dir)) {
    if (IGNORAR.has(entrada)) continue
    const p = join(dir, entrada)
    if (statSync(p).isDirectory()) listar(p, out)
    else if (EXTS.some(e => entrada.endsWith(e)) && !entrada.includes('.test.')) out.push(p)
  }
  return out
}

function resolver(especificador: string, desde: string): string | null {
  let base: string
  if (especificador.startsWith('@/')) base = join(RAIZ, especificador.slice(2))
  else if (especificador.startsWith('.')) base = resolve(dirname(desde), especificador)
  else return null // paquete de node_modules: no nos interesa el grafo interno
  for (const e of EXTS) if (existsSync(base + e)) return base + e
  for (const e of EXTS) if (existsSync(join(base, 'index' + e))) return join(base, 'index' + e)
  return null
}

/**
 * Importaciones reales, ignorando las que sólo son tipos.
 *
 * `import type { X } from '...'` se borra al compilar y NO arrastra el
 * módulo, así que contarlo daría falsos positivos. El regex exige
 * además que la línea empiece por import/export para no tragarse
 * menciones dentro de comentarios — este mismo fichero es un ejemplo de
 * por qué: los docstrings del repo citan rutas de módulos.
 */
function importacionesDeValor(texto: string): string[] {
  const fuera: string[] = []
  const re = /^[ \t]*(?:import|export)\s+([^;]*?)\s*from\s*['"]([^'"]+)['"]/gm
  for (const m of texto.matchAll(re)) {
    const clausula = m[1]
    if (/^type\b/.test(clausula)) continue // `import type ... from`
    // `import { type A, type B } from` también se borra entero.
    const nombres = clausula.match(/\{([^}]*)\}/)?.[1]
    if (nombres && !clausula.trim().startsWith('*')) {
      const partes = nombres.split(',').map(s => s.trim()).filter(Boolean)
      const soloTipos = partes.length > 0 && partes.every(s => s.startsWith('type '))
      const hayDefault = /^[A-Za-z_$][\w$]*\s*,/.test(clausula.trim())
      if (soloTipos && !hayDefault) continue
    }
    fuera.push(m[2])
  }
  // `import 'modulo'` por efectos secundarios.
  for (const m of texto.matchAll(/^[ \t]*import\s+['"]([^'"]+)['"]/gm)) fuera.push(m[1])
  return fuera
}

function relativo(p: string): string {
  return p.slice(RAIZ.length + 1).split(sep).join('/')
}

describe('paquete de cliente · aislamiento de la base de datos', () => {
  const ficheros = listar(RAIZ)
  const grafo = new Map<string, string[]>()
  const clientes: string[] = []

  for (const f of ficheros) {
    const texto = readFileSync(f, 'utf8')
    if (/^\s*['"]use client['"]/m.test(texto.slice(0, 400))) clientes.push(f)
    grafo.set(
      f,
      importacionesDeValor(texto)
        .map(e => resolver(e, f))
        .filter((x): x is string => x !== null),
    )
  }

  it('hay componentes de cliente que analizar (si no, el test es vacuo)', () => {
    expect(clientes.length).toBeGreaterThan(10)
  })

  it.each(PROHIBIDOS)('ningún cliente llega a %s', prohibido => {
    const objetivo = join(RAIZ, ...prohibido.split('/'))
    const culpables: string[] = []

    for (const entrada of clientes) {
      const previo = new Map<string, string | null>([[entrada, null]])
      const cola = [entrada]
      let encontrado: string | null = null
      while (cola.length > 0) {
        const nodo = cola.shift() as string
        if (nodo === objetivo) { encontrado = nodo; break }
        for (const dep of grafo.get(nodo) ?? []) {
          if (!previo.has(dep)) { previo.set(dep, nodo); cola.push(dep) }
        }
      }
      if (encontrado) {
        const camino: string[] = []
        for (let n: string | null = encontrado; n; n = previo.get(n) ?? null) camino.unshift(relativo(n))
        culpables.push(camino.join('\n     -> '))
      }
    }

    expect(
      culpables,
      `Estos componentes de cliente arrastran ${prohibido} —y con él @libsql/client— al ` +
        `navegador, donde no puede conectarse:\n\n  ${culpables.join('\n\n  ')}\n\n` +
        `Mueve el tipo o la constante que necesitan a un fichero *.catalog.ts sin ` +
        `importaciones de servidor. Recuerda: importar un TIPO es gratis, importar un ` +
        `VALOR arrastra el módulo entero.`,
    ).toEqual([])
  })
})
