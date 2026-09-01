import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * La función tiene que ejecutarse cerca de Open-Meteo.
 *
 * EL INCIDENTE QUE FIJA ESTO. Con `regions: ["iad1"]` (Washington), la
 * petición grande de pronóstico —15 modelos × 16 días, del orden de 350
 * KB— NO se completaba en 15 s desde la función, y `/api/forecast`
 * devolvía 502. Medido el mismo día, con la MISMA URL:
 *
 *   desde Europa, directo al proveedor .... 0,67 s · 346 KB · HTTP 200
 *   desde la función en iad1 .............. abortada a los 15,27 s · 502
 *
 * Lo que hacía el fallo difícil de ver: las peticiones PEQUEÑAS al mismo
 * proveedor (geocodificación directa e inversa) respondían en 0,65 s sin
 * problema, y las ciudades ya cacheadas se servían desde Turso sin tocar
 * la red. Así que la app parecía funcionar — sólo fallaba al buscar una
 * ciudad que nadie hubiera pedido antes, que es justo lo que hace un
 * visitante nuevo.
 *
 * Open-Meteo se sirve desde infraestructura alemana, así que `fra1` deja
 * la petición prácticamente local.
 *
 * SI ALGUIEN QUIERE VOLVER A EE. UU.: hay que resolver antes cómo se
 * trae esa respuesta, porque el 502 vuelve. No es una preferencia de
 * latencia, es la diferencia entre que la app cargue datos o no.
 */

const REGIONES_EUROPEAS = new Set(['fra1', 'cdg1', 'arn1', 'dub1', 'lhr1'])

const vercel = JSON.parse(
  readFileSync(join(__dirname, '..', '..', 'vercel.json'), 'utf8'),
) as { regions?: string[] }

describe('región de despliegue', () => {
  it('vercel.json declara una región', () => {
    // Sin ella Vercel elige por su cuenta, y la elección por defecto es
    // justo la que rompía el pronóstico.
    expect(vercel.regions, 'vercel.json necesita `regions`').toBeInstanceOf(Array)
    expect(vercel.regions!.length).toBeGreaterThan(0)
  })

  it('la región está en Europa, cerca del proveedor de datos', () => {
    for (const r of vercel.regions!) {
      expect(
        REGIONES_EUROPEAS.has(r),
        `"${r}" no es una región europea. Desde iad1 la petición de pronóstico ` +
          `(350 KB, 15 modelos) se abortaba a los 15 s y /api/forecast devolvía ` +
          `502 para cualquier ciudad no cacheada.`,
      ).toBe(true)
    }
  })
})
