/**
 * Natural-language weather query → typed parameters, via TypeSafe.
 *
 * The split of responsibilities is deliberate and follows TypeSafe's
 * "code owns the workflow" model:
 *
 *   - TypeSafe answers *closed-set* judgments (is this a weather
 *     question? which variable? which horizon?) and *selects* a place
 *     from candidates supplied by code. It never generates strings.
 *   - The caller resolves the selected place to coordinates with the
 *     existing geocoder, and maps the horizons to URL state.
 *
 * Everything here is pure: the question shape and the answer → params
 * mapping can be unit-tested without the SDK, the network, or an API key.
 * The SDK is imported as *types only*, so this module stays runtime-free.
 */

import type { ChoiceQuestion, NoulQuestion } from '@typesafe-ai/sdk'
import type { MetricId } from './models'

export type Locale = 'es' | 'en'

/** A location the caller already knows about (saved city, current one…). */
export interface Candidato {
  id: string
  nombre: string
}

/** Sentinel choice used when the query names no known place. */
export const LUGAR_NINGUNO = '__ninguno__'

export type Horizonte =
  | 'hoy'
  | 'manana'
  | 'pasado_manana'
  | 'este_fin_de_semana'
  | 'esta_semana'
  | 'esta_quincena'
  | 'sin_fecha'

export type Franja =
  | 'por_la_manana'
  | 'mediodia'
  | 'tarde'
  | 'noche'
  | 'todo_el_dia'

export const HORIZONTES: readonly Horizonte[] = [
  'hoy',
  'manana',
  'pasado_manana',
  'este_fin_de_semana',
  'esta_semana',
  'esta_quincena',
  'sin_fecha',
]

export const FRANJAS: readonly Franja[] = [
  'por_la_manana',
  'mediodia',
  'tarde',
  'noche',
  'todo_el_dia',
]

/** Horizon → number of days to look ahead. `sin_fecha` defaults to the week. */
export const HORIZONTE_A_DIAS: Record<Horizonte, 1 | 2 | 3 | 7 | 14> = {
  hoy: 1,
  manana: 2,
  pasado_manana: 3,
  este_fin_de_semana: 7,
  esta_semana: 7,
  esta_quincena: 14,
  sin_fecha: 7,
}

/** Topic → the app's metric id. `otra` is a deliberate no-match outcome. */
export const TEMA_A_METRIC: Record<string, MetricId | null> = {
  temperatura: 'temperature',
  viento: 'wind_speed',
  rachas: 'wind_gusts',
  lluvia: 'precipitation',
  probabilidad_lluvia: 'precipitation_probability',
  nubes: 'cloud_cover',
  humedad: 'humidity',
  radiacion_uv: 'uv_index',
  presion: 'pressure',
  calidad_aire: 'european_aqi',
  olas: 'wave_height',
  temperatura_mar: 'sea_surface_temperature',
  otra: null,
}

const TEMA_DESC: Record<string, { es: string; en: string }> = {
  temperatura: { es: 'Cuánto calor o frío hará', en: 'How hot or cold it will be' },
  viento: { es: 'Velocidad o dirección del viento', en: 'Wind speed or direction' },
  rachas: { es: 'Rachas fuertes de viento', en: 'Strong wind gusts' },
  lluvia: { es: 'Si llueve, ha llovido o va a llover', en: 'Whether it rains, rained or will rain' },
  probabilidad_lluvia: { es: 'Probabilidad o riesgo de lluvia', en: 'Chance or risk of rain' },
  nubes: { es: 'Nubosidad o si estará despejado', en: 'Cloud cover or whether it will be clear' },
  humedad: { es: 'Humedad del aire', en: 'Air humidity' },
  radiacion_uv: { es: 'Índice de radiación ultravioleta', en: 'UV index' },
  presion: { es: 'Presión atmosférica', en: 'Atmospheric pressure' },
  calidad_aire: { es: 'Calidad del aire o polen', en: 'Air quality or pollen' },
  olas: { es: 'Altura o estado del mar y las olas', en: 'Sea state or wave height' },
  temperatura_mar: { es: 'Temperatura del agua del mar', en: 'Sea surface temperature' },
  otra: { es: 'Otra cosa, o no está claro', en: 'Something else, or unclear' },
}

const HORIZONTE_DESC: Record<Horizonte, { es: string; en: string }> = {
  hoy: { es: 'Hoy, ahora mismo o durante el día de hoy', en: 'Today, right now or during today' },
  manana: { es: 'Mañana', en: 'Tomorrow' },
  pasado_manana: { es: 'Pasado mañana', en: 'The day after tomorrow' },
  este_fin_de_semana: { es: 'Este fin de semana', en: 'This weekend' },
  esta_semana: { es: 'Los próximos días, sin fecha concreta de esta semana', en: 'The coming days, within this week' },
  esta_quincena: { es: 'Dentro de una o dos semanas', en: 'Within a week or two' },
  sin_fecha: { es: 'No concreta cuándo, o la pregunta no es temporal', en: 'No time frame given, or the question is not time-specific' },
}

const FRANJA_DESC: Record<Franja, { es: string; en: string }> = {
  por_la_manana: { es: 'Por la mañana (aprox. 06:00–12:00)', en: 'In the morning (approx. 06:00–12:00)' },
  mediodia: { es: 'Al mediodía (aprox. 12:00–15:00)', en: 'At midday (approx. 12:00–15:00)' },
  tarde: { es: 'Por la tarde (aprox. 15:00–20:00)', en: 'In the afternoon (approx. 15:00–20:00)' },
  noche: { es: 'Por la noche o de madrugada', en: 'At night or in the small hours' },
  todo_el_dia: { es: 'Todo el día, o no concreta una franja', en: 'All day, or no time of day given' },
}

// A `type` alias (not an `interface`) on purpose: TypeScript only infers an
// implicit index signature for object-literal types, which is what lets this
// be passed straight to `systemOne<Q extends Questions>`.
export type ConsultaQuestions = {
  es_meteo: NoulQuestion
  tema: ChoiceQuestion
  horizonte: ChoiceQuestion
  franja: ChoiceQuestion
  lugar?: ChoiceQuestion
}

/**
 * Build the TypeSafe questions for one query. Pure and deterministic.
 *
 * The `lugar` question only exists when the caller supplies candidates —
 * TypeSafe selects among them; it is never asked to invent a place name.
 */
export function buildConsultaQuestions(opts: {
  candidatos?: Candidato[]
  locale?: Locale
} = {}): ConsultaQuestions {
  const locale: Locale = opts.locale === 'en' ? 'en' : 'es'
  const pick = (v: { es: string; en: string }) => v[locale]

  const temaCriteria: Record<string, string> = {}
  for (const key of Object.keys(TEMA_A_METRIC)) temaCriteria[key] = pick(TEMA_DESC[key])

  const horizonteCriteria: Record<string, string> = {}
  for (const key of HORIZONTES) horizonteCriteria[key] = pick(HORIZONTE_DESC[key])

  const franjaCriteria: Record<string, string> = {}
  for (const key of FRANJAS) franjaCriteria[key] = pick(FRANJA_DESC[key])

  const tema: ChoiceQuestion = {
    type: 'choice',
    instructions: locale === 'en'
      ? 'Which weather variable is the query about?'
      : '¿Sobre qué variable meteorológica es la consulta?',
    criteria: temaCriteria,
  }

  const horizonte: ChoiceQuestion = {
    type: 'choice',
    instructions: locale === 'en'
      ? 'What time frame is the person asking about?'
      : '¿Para cuándo quiere saber el tiempo?',
    criteria: horizonteCriteria,
  }

  const franja: ChoiceQuestion = {
    type: 'choice',
    instructions: locale === 'en'
      ? 'If a part of the day is mentioned, which one?'
      : 'Si se menciona una parte del día, ¿cuál?',
    criteria: franjaCriteria,
  }

  const es_meteo: NoulQuestion = {
    type: 'noul',
    instructions: locale === 'en'
      ? 'Does this query ask about the weather or the state of the atmosphere (temperature, rain, wind, clouds, UV, air, sea…) for some place or time?'
      : '¿La consulta pregunta por el tiempo o el estado de la atmósfera (temperatura, lluvia, viento, nubes, UV, aire, mar…) en algún lugar o momento?',
    criteria: {
      true: locale === 'en' ? 'It is a weather question' : 'Es una pregunta sobre el tiempo',
      false: locale === 'en' ? 'It is not about weather' : 'No trata sobre el tiempo',
    },
  }

  const questions: ConsultaQuestions = { es_meteo, tema, horizonte, franja }

  const candidatos = opts.candidatos ?? []
  if (candidatos.length > 0) {
    const lugarCriteria: Record<string, string> = {}
    for (const c of candidatos) lugarCriteria[c.id] = c.nombre
    lugarCriteria[LUGAR_NINGUNO] = locale === 'en'
      ? 'None of these places, or no place is mentioned'
      : 'Ninguno de estos lugares, o no se menciona ningún lugar'
    questions.lugar = {
      type: 'choice',
      instructions: locale === 'en'
        ? 'Which known place is the query about?'
        : '¿A cuál de estos lugares conocidos se refiere la consulta?',
      criteria: lugarCriteria,
    }
  }

  return questions
}

/** Structural view of the answers we consume (kept SDK-free on purpose). */
export interface ConsultaAnswerSet {
  es_meteo?: { noul: number }
  tema?: { choice: string; confidence: number }
  horizonte?: { choice: string; confidence: number }
  franja?: { choice: string; confidence: number }
  lugar?: { choice: string; confidence: number }
}

export interface ConsultaParams {
  esConsultaMeteo: boolean
  tema: MetricId | null
  horizonte: Horizonte
  horizonteDias: 1 | 2 | 3 | 7 | 14
  franja: Franja
  lugar: Candidato | null
  confianza: {
    esConsultaMeteo: number
    tema: number
    horizonte: number
    franja: number
    lugar: number | null
  }
}

/** Probability above which we treat the query as being about weather. */
export const UMBRAL_ES_METEO = 0.5

function isHorizonte(value: string | undefined): value is Horizonte {
  return value !== undefined && (HORIZONTES as readonly string[]).includes(value)
}

function isFranja(value: string | undefined): value is Franja {
  return value !== undefined && (FRANJAS as readonly string[]).includes(value)
}

/**
 * Map TypeSafe answers to typed params. Pure: unknown choices fall back
 * to safe defaults instead of leaking an arbitrary string into the UI.
 */
export function toConsultaParams(
  answers: ConsultaAnswerSet,
  opts: { candidatos?: Candidato[] } = {},
): ConsultaParams {
  const candidatos = opts.candidatos ?? []

  const esConsultaMeteo = (answers.es_meteo?.noul ?? 0) >= UMBRAL_ES_METEO

  const temaKey = answers.tema?.choice
  const tema = temaKey && temaKey in TEMA_A_METRIC ? TEMA_A_METRIC[temaKey] : null

  const horizonte = isHorizonte(answers.horizonte?.choice) ? answers.horizonte.choice : 'sin_fecha'
  const franja = isFranja(answers.franja?.choice) ? answers.franja.choice : 'todo_el_dia'

  const lugarId = answers.lugar?.choice
  const lugar =
    lugarId && lugarId !== LUGAR_NINGUNO
      ? candidatos.find((c) => c.id === lugarId) ?? null
      : null

  return {
    esConsultaMeteo,
    tema,
    horizonte,
    horizonteDias: HORIZONTE_A_DIAS[horizonte],
    franja,
    lugar,
    confianza: {
      esConsultaMeteo: answers.es_meteo?.noul ?? 0,
      tema: answers.tema?.confidence ?? 0,
      horizonte: answers.horizonte?.confidence ?? 0,
      franja: answers.franja?.confidence ?? 0,
      lugar: answers.lugar?.confidence ?? null,
    },
  }
}

/** Cap the candidate list so a malicious caller can't blow up the prompt. */
export const MAX_CANDIDATOS = 40

export function sanitizeCandidatos(raw: unknown): Candidato[] {
  if (!Array.isArray(raw)) return []
  const out: Candidato[] = []
  for (const item of raw) {
    if (out.length >= MAX_CANDIDATOS) break
    if (!item || typeof item !== 'object') continue
    const { id, nombre } = item as { id?: unknown; nombre?: unknown }
    if (typeof id !== 'string' || typeof nombre !== 'string') continue
    const cleanId = id.trim().slice(0, 64)
    const cleanNombre = nombre.trim().slice(0, 120)
    if (!cleanId || !cleanNombre) continue
    out.push({ id: cleanId, nombre: cleanNombre })
  }
  return out
}
