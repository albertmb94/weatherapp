import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { MIGRATIONS } from '../migrations'

/**
 * El DDL caro no puede correr dentro de una petición.
 *
 * EL FALLO QUE ESTO FIJA, y que se detectó en producción. El índice
 * sobre `fetched_at` se añadió dentro de `cacheStore.ensureSchema()`
 * para que la purga (`DELETE ... WHERE fetched_at < ?`) dejara de hacer
 * un recorrido completo. El índice está bien; el sitio estaba mal.
 *
 * `ensureSchema()` corre DENTRO de `/api/forecast`, en la ruta de la
 * petición. `CREATE INDEX` sobre una tabla cuyas filas son respuestas
 * enteras de Open-Meteo —cientos de KB cada una— no es instantáneo, así
 * que la PRIMERA petición tras el despliegue se comía la construcción
 * del índice, agotaba el presupuesto de tiempo del proxy y devolvía 502.
 * Traducido a lo que ve la gente: buscas una ciudad y no carga nada.
 *
 * Un arreglo de coste que provoca una caída no es un arreglo. Las
 * migraciones corren desde `instrumentation.ts` al arrancar la
 * instancia, fuera de toda ruta: ese es su sitio.
 */

const cacheStore = readFileSync(join(__dirname, '..', 'cacheStore.ts'), 'utf8')

/** Quita comentarios para no confundir la explicación con el código. */
function soloCodigo(fuente: string): string {
  return fuente
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(l => !l.trim().startsWith('//'))
    .join('\n')
}

describe('DDL fuera de la ruta de petición', () => {
  it('cacheStore NO crea índices: su ensureSchema corre dentro de /api/forecast', () => {
    const codigo = soloCodigo(cacheStore)
    expect(
      /CREATE\s+INDEX/i.test(codigo),
      'CREATE INDEX en cacheStore se paga en la primera petición tras el despliegue ' +
        'y ya provocó un 502. Ponlo en una migración.',
    ).toBe(false)
  })

  it('cacheStore sigue creando su tabla (sobre una existente no cuesta nada)', () => {
    expect(/CREATE TABLE IF NOT EXISTS/i.test(soloCodigo(cacheStore))).toBe(true)
  })

  it('las dos cachés tienen su índice de purga en las migraciones', () => {
    const sql = MIGRATIONS.flatMap(m => m.statements).join('\n')
    for (const tabla of ['forecast_cache', 'marine_cache']) {
      expect(
        sql.includes(`ON ${tabla} (fetched_at)`) && sql.includes('CREATE INDEX IF NOT EXISTS'),
        `falta el índice de purga de ${tabla}`,
      ).toBe(true)
      // El índice necesita que la tabla exista: la migración puede
      // ejecutarse antes de que nadie pida un pronóstico.
      expect(
        sql.includes(`CREATE TABLE IF NOT EXISTS ${tabla}`),
        `${tabla} debe crearse en la misma migración que su índice`,
      ).toBe(true)
    }
  })

  it('cada migración tiene una versión única y creciente', () => {
    const versiones = MIGRATIONS.map(m => m.version)
    expect(new Set(versiones).size).toBe(versiones.length)
    expect([...versiones].sort((a, b) => a - b)).toEqual(versiones)
  })
})
