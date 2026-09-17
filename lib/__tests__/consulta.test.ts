import { describe, it, expect } from 'vitest'
import {
  HORIZONTE_A_DIAS,
  LUGAR_NINGUNO,
  MAX_CANDIDATOS,
  buildConsultaQuestions,
  sanitizeCandidatos,
  toConsultaParams,
  type Candidato,
} from '@/lib/consulta'

const CANDIDATOS: Candidato[] = [
  { id: 'madrid', nombre: 'Madrid' },
  { id: 'girona', nombre: 'Girona' },
]

describe('buildConsultaQuestions', () => {
  it('always asks the four core questions', () => {
    const q = buildConsultaQuestions()
    expect(q.es_meteo.type).toBe('noul')
    expect(q.tema.type).toBe('choice')
    expect(q.horizonte.type).toBe('choice')
    expect(q.franja.type).toBe('choice')
  })

  it('omits the place question when there are no candidates', () => {
    expect(buildConsultaQuestions().lugar).toBeUndefined()
    expect(buildConsultaQuestions({ candidatos: [] }).lugar).toBeUndefined()
  })

  it('builds a place question over candidates plus the none sentinel', () => {
    const q = buildConsultaQuestions({ candidatos: CANDIDATOS })
    expect(q.lugar?.criteria.madrid).toBe('Madrid')
    expect(q.lugar?.criteria.girona).toBe('Girona')
    expect(q.lugar?.criteria).toHaveProperty(LUGAR_NINGUNO)
  })

  it('localises instructions and criteria', () => {
    const es = buildConsultaQuestions({ locale: 'es' })
    const en = buildConsultaQuestions({ locale: 'en' })
    expect(es.tema.instructions).not.toBe(en.tema.instructions)
    expect(es.horizonte.criteria.hoy).not.toBe(en.horizonte.criteria.hoy)
    // Unknown locale falls back to Spanish.
    expect(buildConsultaQuestions({ locale: 'fr' as never }).tema.criteria).toEqual(
      es.tema.criteria,
    )
  })

  it('covers every topic key with a description', () => {
    const { tema } = buildConsultaQuestions()
    for (const key of Object.keys(tema.criteria)) {
      expect(typeof tema.criteria[key]).toBe('string')
      expect((tema.criteria[key] as string).length).toBeGreaterThan(0)
    }
  })
})

describe('toConsultaParams', () => {
  const base = {
    es_meteo: { noul: 0.97 },
    tema: { choice: 'lluvia', confidence: 0.9 },
    horizonte: { choice: 'manana' as const, confidence: 0.8 },
    franja: { choice: 'tarde' as const, confidence: 0.7 },
  }

  it('maps a full answer set', () => {
    const p = toConsultaParams({ ...base, lugar: { choice: 'girona', confidence: 0.95 } }, {
      candidatos: CANDIDATOS,
    })
    expect(p.esConsultaMeteo).toBe(true)
    expect(p.tema).toBe('precipitation')
    expect(p.horizonte).toBe('manana')
    expect(p.horizonteDias).toBe(HORIZONTE_A_DIAS.manana)
    expect(p.franja).toBe('tarde')
    expect(p.lugar).toEqual({ id: 'girona', nombre: 'Girona' })
    expect(p.confianza).toEqual({
      esConsultaMeteo: 0.97,
      tema: 0.9,
      horizonte: 0.8,
      franja: 0.7,
      lugar: 0.95,
    })
  })

  it('treats a low weather probability as not-a-weather-question', () => {
    expect(toConsultaParams({ ...base, es_meteo: { noul: 0.2 } }).esConsultaMeteo).toBe(false)
    expect(toConsultaParams({ ...base, es_meteo: { noul: 0.5 } }).esConsultaMeteo).toBe(true)
    expect(toConsultaParams({}).esConsultaMeteo).toBe(false)
  })

  it('maps the "otra" topic to no metric', () => {
    const p = toConsultaParams({ ...base, tema: { choice: 'otra', confidence: 0.6 } })
    expect(p.tema).toBeNull()
    expect(p.confianza.tema).toBe(0.6)
  })

  it('falls back to safe defaults for unknown or missing choices', () => {
    const p = toConsultaParams({ ...base, tema: { choice: 'inventado', confidence: 0.3 }, horizonte: { choice: 'x', confidence: 0.1 }, franja: { choice: 'y', confidence: 0.1 } })
    expect(p.tema).toBeNull()
    expect(p.horizonte).toBe('sin_fecha')
    expect(p.horizonteDias).toBe(7)
    expect(p.franja).toBe('todo_el_dia')
  })

  it('ignores the none sentinel and unknown place ids', () => {
    expect(toConsultaParams({ ...base, lugar: { choice: LUGAR_NINGUNO, confidence: 0.9 } }, { candidatos: CANDIDATOS }).lugar).toBeNull()
    expect(toConsultaParams({ ...base, lugar: { choice: 'nowhere', confidence: 0.9 } }, { candidatos: CANDIDATOS }).lugar).toBeNull()
    expect(toConsultaParams({ ...base }).confianza.lugar).toBeNull()
  })
})

describe('sanitizeCandidatos', () => {
  it('rejects non-arrays', () => {
    expect(sanitizeCandidatos(undefined)).toEqual([])
    expect(sanitizeCandidatos('Madrid')).toEqual([])
  })

  it('drops malformed entries and trims values', () => {
    expect(
      sanitizeCandidatos([
        { id: '  madrid  ', nombre: '  Madrid ' },
        { id: 1, nombre: 'Bad' },
        { id: 'x' },
        null,
        { id: '', nombre: 'Empty' },
      ]),
    ).toEqual([{ id: 'madrid', nombre: 'Madrid' }])
  })

  it(`caps the list at ${MAX_CANDIDATOS}`, () => {
    const many = Array.from({ length: 100 }, (_, i) => ({ id: `c${i}`, nombre: `C${i}` }))
    expect(sanitizeCandidatos(many)).toHaveLength(MAX_CANDIDATOS)
  })
})
