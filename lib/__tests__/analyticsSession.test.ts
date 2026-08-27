import { describe, it, expect, vi } from 'vitest'
import { resolveSession, SESSION_TTL_MS } from '@/lib/analytics/session'

const NOW = Date.UTC(2026, 7, 27, 12, 0)
const MIN = 60_000

/** Generador determinista para poder afirmar sobre el id emitido. */
function idGen(prefix = 'nuevo') {
  let n = 0
  return vi.fn(() => `${prefix}-${++n}`)
}

describe('resolveSession', () => {
  it('sin cookie previa abre sesión', () => {
    const newId = idGen()
    const r = resolveSession(undefined, 0, NOW, newId)
    expect(r).toEqual({ sessionId: 'nuevo-1', isNew: true })
    expect(newId).toHaveBeenCalledOnce()
  })

  it('a los 29 min de inactividad MANTIENE la sesión', () => {
    const newId = idGen()
    const r = resolveSession('sess-abc', NOW - 29 * MIN, NOW, newId)
    expect(r).toEqual({ sessionId: 'sess-abc', isNew: false })
    expect(newId).not.toHaveBeenCalled()
  })

  it('justo en el límite de 30 min todavía la mantiene', () => {
    const r = resolveSession('sess-abc', NOW - SESSION_TTL_MS, NOW, idGen())
    expect(r).toEqual({ sessionId: 'sess-abc', isNew: false })
  })

  it('a los 31 min ROTA a una sesión nueva', () => {
    const newId = idGen()
    const r = resolveSession('sess-abc', NOW - 31 * MIN, NOW, newId)
    expect(r.isNew).toBe(true)
    expect(r.sessionId).toBe('nuevo-1')
    expect(r.sessionId).not.toBe('sess-abc')
  })

  it('esta rotación es la que faltaba: el código viejo devolvía SIEMPRE el id previo', () => {
    // Regresión del bug de proxy.ts: `isNewSession` se calculaba y se
    // descartaba, así que un visitante con 200 visitas en 6 meses tenía
    // una única fila en `sessions`, con started_at de su primer día.
    let id = 'sess-original'
    let last = NOW
    let sesiones = 1
    for (let dia = 1; dia <= 30; dia++) {
      const visita = NOW + dia * 24 * 60 * MIN
      const r = resolveSession(id, last, visita, idGen(`d${dia}`))
      if (r.isNew) sesiones++
      id = r.sessionId
      last = visita
    }
    // 30 visitas en 30 días distintos = 30 sesiones nuevas + la inicial.
    expect(sesiones).toBe(31)
  })

  it('un reloj de cliente adelantado (lastSeen futuro) no rompe la sesión', () => {
    const newId = idGen()
    const r = resolveSession('sess-abc', NOW + 10 * MIN, NOW, newId)
    expect(r).toEqual({ sessionId: 'sess-abc', isNew: false })
    expect(newId).not.toHaveBeenCalled()
  })

  it('con id previo pero lastSeen ausente o corrupto abre sesión (fail-safe)', () => {
    for (const malo of [0, -1, NaN, Infinity]) {
      const r = resolveSession('sess-abc', malo, NOW, idGen())
      expect(r.isNew).toBe(true)
      expect(r.sessionId).not.toBe('sess-abc')
    }
  })

  it('cadena vacía como id previo cuenta como ausencia', () => {
    const r = resolveSession('', NOW - MIN, NOW, idGen())
    expect(r.isNew).toBe(true)
  })
})
