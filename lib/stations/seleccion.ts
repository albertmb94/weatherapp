import { haversineKm } from '@/lib/geoDistance'

/**
 * Qué estaciones se devuelven para una ubicación.
 *
 * LA REGLA: las que estén dentro del radio, y si son menos de `minCount`,
 * las `minCount` más cercanas. Es decir, la condición que devuelva MÁS
 * datos de las dos.
 *
 * POR QUÉ NO BASTA EL RADIO SOLO. El radio por defecto fue 5 km, se
 * subió a 10 porque en ciudades como Badalona no había ninguna estación
 * dentro de 5 km: la pestaña de estaciones se veía bien pero la mezcla
 * "estación + ensemble" del nowcast no se activaba nunca. Subir el radio
 * arreglaba ese caso y empeoraba el contrario — en zonas densas metía
 * estaciones lejanas que no aportan.
 *
 * Con el mínimo por conteo se puede volver a un radio ajustado sin
 * reintroducir aquel fallo: donde hay muchas cerca se devuelven todas las
 * de 5 km, y donde no hay ninguna se devuelven las 5 más cercanas aunque
 * estén a 30 km. El radio deja de ser un compromiso entre dos casos que
 * se contradicen.
 *
 * POR QUÉ ES UNA FUNCIÓN PURA Y COMPARTIDA: la aplican las rutas de API
 * (para no mandar al cliente más de lo que va a usar) y también el
 * cliente al fusionar las dos redes. Si cada lado la implementara por su
 * cuenta, acabarían discrepando y "las 5 más cercanas" significaría una
 * cosa distinta en cada sitio.
 */

export const RADIO_ESTACIONES_KM = 5
export const MINIMO_ESTACIONES = 5

export interface ConCoordenadas {
  lat: number
  lon: number
}

export interface OpcionesSeleccion<T = unknown> {
  radiusKm?: number
  minCount?: number
  /**
   * Identidad de la ESTACIÓN, si el proveedor manda varias lecturas de la
   * misma. Sin esto, "las 5 más cercanas" devuelve 5 observaciones del
   * mismo sitio en vez de 5 estaciones.
   */
  idDe?: (e: T) => string | null | undefined
  /**
   * Marca temporal de la lectura. Al colapsar por estación se conserva la
   * MÁS RECIENTE. Sin esto se conservaba la primera del lote, que en
   * AEMET es la MÁS ANTIGUA (publica por horas en orden ascendente): el
   * nowcast venía mezclando la lectura más vieja disponible.
   */
  frescuraDe?: (e: T) => number | null | undefined
}

/**
 * Devuelve las estaciones seleccionadas, SIEMPRE ordenadas de más cerca a
 * más lejos. El orden importa: el nowcast se queda con la primera.
 */
export function seleccionarEstaciones<T extends ConCoordenadas>(
  estaciones: readonly T[],
  centro: readonly [number, number],
  {
    radiusKm = RADIO_ESTACIONES_KM,
    minCount = MINIMO_ESTACIONES,
    idDe,
    frescuraDe,
  }: OpcionesSeleccion<T> = {},
): T[] {
  if (estaciones.length === 0) return []

  // Una fila por ESTACIÓN, la más reciente. Va antes de ordenar por
  // distancia porque si no, el mínimo por conteo se gasta en lecturas
  // repetidas del mismo sitio.
  const unaPorEstacion = idDe ? colapsarPorEstacion(estaciones, idDe, frescuraDe) : estaciones

  const conDistancia = unaPorEstacion
    .map(e => ({ e, km: haversineKm([e.lat, e.lon], [centro[0], centro[1]]) }))
    .filter(x => Number.isFinite(x.km))
    .sort((a, b) => a.km - b.km)

  const dentro = conDistancia.filter(x => x.km <= radiusKm)

  // La que devuelva más: el radio si alcanza el mínimo, y si no las
  // `minCount` más cercanas (que pueden ser menos, si no hay tantas).
  const elegidas = dentro.length >= minCount ? dentro : conDistancia.slice(0, minCount)
  return elegidas.map(x => x.e)
}

function colapsarPorEstacion<T>(
  estaciones: readonly T[],
  idDe: (e: T) => string | null | undefined,
  frescuraDe?: (e: T) => number | null | undefined,
): T[] {
  const mejor = new Map<string, T>()
  const sinId: T[] = []
  for (const e of estaciones) {
    const id = idDe(e)
    if (!id) {
      // Sin identificador no se puede agrupar: se conserva tal cual en
      // vez de descartarla o de meterla toda en un mismo grupo.
      sinId.push(e)
      continue
    }
    const previa = mejor.get(id)
    if (!previa) {
      mejor.set(id, e)
      continue
    }
    if (!frescuraDe) continue
    const a = frescuraDe(previa)
    const bb = frescuraDe(e)
    if (typeof bb === 'number' && Number.isFinite(bb) && (typeof a !== 'number' || !Number.isFinite(a) || bb > a)) {
      mejor.set(id, e)
    }
  }
  return [...mejor.values(), ...sinId]
}

/** Lee y acota los parámetros de la petición. */
export function parametrosSeleccion(sp: URLSearchParams): { radiusKm: number; minCount: number } {
  const radioBruto = Number(sp.get('radius') ?? RADIO_ESTACIONES_KM)
  const minBruto = Number(sp.get('minCount') ?? MINIMO_ESTACIONES)
  return {
    // Acotado: `?radius=1e9` devolvía las ~900 estaciones de golpe.
    radiusKm: Number.isFinite(radioBruto) ? Math.min(Math.max(radioBruto, 1), 500) : RADIO_ESTACIONES_KM,
    // Acotado también: sin tope, `?minCount=900` es el mismo problema por
    // la otra puerta.
    minCount: Number.isFinite(minBruto) ? Math.min(Math.max(Math.trunc(minBruto), 0), 50) : MINIMO_ESTACIONES,
  }
}
