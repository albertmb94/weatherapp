import { describe, it, expect } from 'vitest'
import {
  MINIMO_ESTACIONES,
  RADIO_ESTACIONES_KM,
  parametrosSeleccion,
  seleccionarEstaciones,
} from '@/lib/stations/seleccion'

/**
 * "Dentro del radio, o las N más cercanas — la que devuelva más".
 *
 * La regla existe porque el radio solo era un compromiso imposible: con
 * 5 km, ciudades como Badalona se quedaban sin ninguna estación y la
 * mezcla del nowcast no se activaba nunca; se subió a 10 km y entonces en
 * zonas densas entraban estaciones lejanas que no aportan. El mínimo por
 * conteo permite un radio ajustado sin reintroducir aquel fallo.
 */

const CENTRO: [number, number] = [41.45, 2.2475] // Badalona

/** Estación a `km` al norte del centro (0.009° ≈ 1 km de latitud). */
function aKm(km: number, id: string) {
  return { id, lat: CENTRO[0] + km * 0.009, lon: CENTRO[1] }
}

describe('seleccionarEstaciones', () => {
  it('con muchas cerca devuelve TODAS las del radio, no sólo el mínimo', () => {
    const estaciones = [1, 2, 3, 4].map(k => aKm(k, `d${k}`))
      .concat([6, 7].map(k => aKm(k, `f${k}`)))
      .concat([aKm(0.5, 'd0')])

    const out = seleccionarEstaciones(estaciones, CENTRO, { radiusKm: 5, minCount: 5 })

    // 5 dentro de 5 km (0.5, 1, 2, 3, 4) ≥ mínimo → se devuelven ésas y
    // no se cuelan las de 6 y 7 km.
    expect(out.map(e => e.id)).toEqual(['d0', 'd1', 'd2', 'd3', 'd4'])
  })

  it('con NINGUNA dentro del radio devuelve las N más cercanas', () => {
    // El caso Badalona: la estación útil estaba a más de 5 km y el radio
    // solo la excluía en silencio.
    const estaciones = [8, 12, 20, 31, 45, 60].map(k => aKm(k, `l${k}`))

    const out = seleccionarEstaciones(estaciones, CENTRO, { radiusKm: 5, minCount: 5 })

    expect(out.map(e => e.id)).toEqual(['l8', 'l12', 'l20', 'l31', 'l45'])
  })

  it('con algunas dentro pero por debajo del mínimo, gana el conteo', () => {
    const estaciones = [2, 4].map(k => aKm(k, `d${k}`)).concat([9, 11, 14].map(k => aKm(k, `l${k}`)))

    const out = seleccionarEstaciones(estaciones, CENTRO, { radiusKm: 5, minCount: 5 })

    // 2 dentro < 5 → las 5 más cercanas, que incluyen las de dentro.
    expect(out.map(e => e.id)).toEqual(['d2', 'd4', 'l9', 'l11', 'l14'])
  })

  it('SIEMPRE ordena de más cerca a más lejos', () => {
    // El nowcast se queda con la primera: un orden equivocado le da la
    // estación equivocada sin que nada falle visiblemente.
    const estaciones = [aKm(4, 'c'), aKm(1, 'a'), aKm(2.5, 'b')]

    const out = seleccionarEstaciones(estaciones, CENTRO, { radiusKm: 5, minCount: 5 })

    expect(out.map(e => e.id)).toEqual(['a', 'b', 'c'])
  })

  it('devuelve lo que haya cuando hay menos que el mínimo', () => {
    const out = seleccionarEstaciones([aKm(30, 'unica')], CENTRO, { radiusKm: 5, minCount: 5 })
    expect(out.map(e => e.id)).toEqual(['unica'])
  })

  it('sin estaciones devuelve vacío, no lanza', () => {
    expect(seleccionarEstaciones([], CENTRO)).toEqual([])
  })

  it('descarta coordenadas imposibles en vez de colocarlas primero', () => {
    // Una distancia NaN ordenada al principio pondría una estación
    // inválida como "la más cercana".
    const estaciones = [
      { id: 'rota', lat: Number.NaN, lon: 2.2 },
      aKm(3, 'buena'),
    ]

    const out = seleccionarEstaciones(estaciones, CENTRO, { radiusKm: 5, minCount: 5 })

    expect(out.map(e => e.id)).toEqual(['buena'])
  })

  it('los valores por defecto son 5 km y 5 estaciones', () => {
    expect(RADIO_ESTACIONES_KM).toBe(5)
    expect(MINIMO_ESTACIONES).toBe(5)
  })
})

describe('parametrosSeleccion', () => {
  it('sin parámetros usa los valores por defecto', () => {
    expect(parametrosSeleccion(new URLSearchParams())).toEqual({ radiusKm: 5, minCount: 5 })
  })

  it('acota el radio: `?radius=1e9` devolvía las ~900 estaciones de golpe', () => {
    expect(parametrosSeleccion(new URLSearchParams('radius=1e9')).radiusKm).toBe(500)
    expect(parametrosSeleccion(new URLSearchParams('radius=0')).radiusKm).toBe(1)
  })

  it('acota también el mínimo: es la misma puerta por el otro lado', () => {
    expect(parametrosSeleccion(new URLSearchParams('minCount=900')).minCount).toBe(50)
    expect(parametrosSeleccion(new URLSearchParams('minCount=-5')).minCount).toBe(0)
  })

  it('un valor no numérico cae al de por defecto', () => {
    const p = parametrosSeleccion(new URLSearchParams('radius=muchos&minCount=todas'))
    expect(p).toEqual({ radiusKm: 5, minCount: 5 })
  })
})

describe('una fila por ESTACIÓN, la más reciente', () => {
  // AEMET publica una observación POR HORA por estación. Sin colapsar,
  // "las 5 más cercanas" devolvía 5 lecturas del mismo sitio en vez de 5
  // estaciones — comprobado contra la API real antes de arreglarlo.
  const lecturas = [
    { id: 'A', lat: CENTRO[0] + 0.018, lon: CENTRO[1], t: 100 },
    { id: 'A', lat: CENTRO[0] + 0.018, lon: CENTRO[1], t: 300 },
    { id: 'A', lat: CENTRO[0] + 0.018, lon: CENTRO[1], t: 200 },
    { id: 'B', lat: CENTRO[0] + 0.027, lon: CENTRO[1], t: 50 },
  ]

  it('colapsa las lecturas repetidas a una por estación', () => {
    const out = seleccionarEstaciones(lecturas, CENTRO, {
      radiusKm: 5,
      minCount: 5,
      idDe: e => e.id,
      frescuraDe: e => e.t,
    })

    expect(out.map(e => e.id)).toEqual(['A', 'B'])
  })

  it('conserva la lectura MÁS RECIENTE, no la primera del lote', () => {
    // AEMET las manda en orden ascendente, así que quedarse con la
    // primera era quedarse con la más ANTIGUA: el nowcast venía
    // mezclando la lectura más vieja disponible.
    const out = seleccionarEstaciones(lecturas, CENTRO, {
      radiusKm: 5,
      minCount: 5,
      idDe: e => e.id,
      frescuraDe: e => e.t,
    })

    expect(out.find(e => e.id === 'A')?.t).toBe(300)
  })

  it('el mínimo por conteo cuenta ESTACIONES, no lecturas', () => {
    const muchasDeUna = Array.from({ length: 20 }, (_, i) => ({
      id: 'A', lat: CENTRO[0] + 0.018, lon: CENTRO[1], t: i,
    }))
    const otras = [2, 3, 4].map(k => ({ id: `E${k}`, lat: CENTRO[0] + k * 0.02, lon: CENTRO[1], t: 1 }))

    const out = seleccionarEstaciones([...muchasDeUna, ...otras], CENTRO, {
      radiusKm: 1,
      minCount: 3,
      idDe: e => e.id,
      frescuraDe: e => e.t,
    })

    expect(new Set(out.map(e => e.id)).size).toBe(3)
    expect(out.length).toBe(3)
  })

  it('sin identificador no agrupa: conserva la fila en vez de perderla', () => {
    const out = seleccionarEstaciones(
      [{ id: '', lat: CENTRO[0] + 0.01, lon: CENTRO[1], t: 1 }],
      CENTRO,
      { idDe: e => e.id, frescuraDe: e => e.t },
    )
    expect(out).toHaveLength(1)
  })

  it('sin `idDe` se comporta como antes: no colapsa nada', () => {
    const out = seleccionarEstaciones(lecturas, CENTRO, { radiusKm: 5, minCount: 5 })
    expect(out).toHaveLength(4)
  })
})
