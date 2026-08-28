/**
 * Días de calendario en la zona del producto (Europe/Madrid).
 *
 * Por qué existe este módulo: las consultas de analytics agrupaban con
 * `strftime('%Y-%m-%d', ts / 1000, 'unixepoch')`, que es UTC y **no
 * admite zona horaria** en SQLite. Para una audiencia española eso
 * desplaza la frontera del día 1 h en invierno y 2 h en verano: todo lo
 * ocurrido entre las 00:00 y las 02:00 hora local caía en el día
 * anterior del dashboard. El "hoy" del panel nunca fue el hoy del
 * visitante.
 *
 * La solución no es parchear el SQL —no se puede— sino dejar de calcular
 * el día en SQL: se guarda una columna `day TEXT` ya resuelta en el
 * momento de insertar, y las consultas hacen `GROUP BY day` / `WHERE day
 * >= ?`. Este fichero es la única fuente de verdad de esa conversión.
 *
 * Node 20 y el runtime Edge llevan ICU completo, así que basta `Intl`:
 * cero dependencias.
 */

export const TZ = 'Europe/Madrid'

export const MS_PER_DAY = 86_400_000

/** 'en-CA' produce YYYY-MM-DD de forma nativa. */
const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

const partsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ,
  hour12: false,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

/** Clave de día ('YYYY-MM-DD') del instante dado, en hora de Madrid. */
export function dayKey(ms: number): string {
  return dayFormatter.format(new Date(ms))
}

/** Clave de día de hoy. `now` inyectable para tests. */
export function todayKey(now: number = Date.now()): string {
  return dayKey(now)
}

/** Offset de Madrid respecto a UTC (en ms) en ese instante concreto.
 *  +3600000 en invierno (CET), +7200000 en verano (CEST). */
function offsetMsAt(ms: number): number {
  const parts = partsFormatter.formatToParts(new Date(ms))
  const get = (type: Intl.DateTimeFormatPartTypes): number => {
    const p = parts.find(x => x.type === type)
    return p ? Number(p.value) : 0
  }
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    // Algunas versiones de ICU emiten "24" para medianoche con hour12:false.
    get('hour') % 24,
    get('minute'),
    get('second'),
  )
  return asUtc - ms
}

/**
 * Instante (epoch ms) de la medianoche local con la que empieza esa
 * clave de día.
 *
 * Se resuelve en dos pasadas porque el offset depende del instante que
 * estamos intentando calcular: se parte de la medianoche UTC, se mide el
 * offset ahí, y se recomprueba sobre el resultado. Las dos pasadas sólo
 * difieren en los dos domingos del año en que cambia la hora.
 */
export function dayStartMs(key: string): number {
  const [y, m, d] = key.split('-').map(Number)
  if (!y || !m || !d) throw new Error(`Clave de día inválida: ${key}`)
  const utcMidnight = Date.UTC(y, m - 1, d)
  const firstGuess = utcMidnight - offsetMsAt(utcMidnight)
  const refined = utcMidnight - offsetMsAt(firstGuess)
  return refined
}

/** Instante en que TERMINA ese día local (= inicio del siguiente). */
export function dayEndMs(key: string): number {
  return dayStartMs(nextDayKey(key))
}

/** Clave del día siguiente. Pasa por el mediodía para no tropezar con
 *  el salto DST (a mediodía nunca hay ambigüedad). */
export function nextDayKey(key: string): string {
  return dayKey(dayStartMs(key) + MS_PER_DAY + MS_PER_DAY / 2)
}

/** Clave del día anterior, misma técnica. */
export function prevDayKey(key: string): string {
  return dayKey(dayStartMs(key) - MS_PER_DAY / 2)
}

/**
 * Las `rangeDays` claves que terminan hoy, en orden ASCENDENTE
 * (la más antigua primero, hoy la última).
 */
export function rangeDayKeys(rangeDays: number, now: number = Date.now()): string[] {
  const out: string[] = []
  let key = todayKey(now)
  for (let i = 0; i < rangeDays; i++) {
    out.push(key)
    key = prevDayKey(key)
  }
  return out.reverse()
}

/** Nº de días entre dos claves (b - a). Negativo si b es anterior. */
export function daysBetween(a: string, b: string): number {
  return Math.round((dayStartMs(b) - dayStartMs(a)) / MS_PER_DAY)
}
