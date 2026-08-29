import { describe, it, expect, beforeEach } from 'vitest'
import {
  trackedKey,
  shouldEmit,
  geoCellFrom,
  externalReferrer,
  buildPageviewPayload,
  buildEventPayload,
  newCid,
  resetTrackingContext,
  setTrackingContext,
  getTrackingContext,
  EMIT_DEBOUNCE_MS,
  MAX_PROPERTIES_BYTES,
} from '@/lib/analytics/tracker'

const ORIGIN = 'https://eltiempo.example'
const NOW = Date.UTC(2026, 7, 27, 12, 0)

beforeEach(resetTrackingContext)

describe('geoCellFrom', () => {
  it('redondea a 2 decimales (celda de ~1 km), igual que el formato histórico', () => {
    expect(geoCellFrom(41.4501, 2.2478)).toBe('41.45,2.25')
    expect(geoCellFrom(-0.005, -0.005)).toBe('-0.01,-0.01')
  })

  it('devuelve null para coordenadas ausentes o imposibles', () => {
    expect(geoCellFrom(undefined, 2)).toBeNull()
    expect(geoCellFrom(41, undefined)).toBeNull()
    expect(geoCellFrom(NaN, 2)).toBeNull()
    expect(geoCellFrom(91, 0)).toBeNull()
    expect(geoCellFrom(0, 181)).toBeNull()
  })
})

describe('trackedKey / shouldEmit', () => {
  it('cambiar de ciudad emite', () => {
    setTrackingContext({ lat: 41.45, lon: 2.25, view: 'resumen' })
    const a = trackedKey('/', getTrackingContext())
    setTrackingContext({ lat: 40.42, lon: -3.7 })
    const b = trackedKey('/', getTrackingContext())
    expect(shouldEmit(a, b)).toBe(true)
  })

  it('cambiar de vista emite', () => {
    setTrackingContext({ lat: 41.45, lon: 2.25, view: 'resumen' })
    const a = trackedKey('/', getTrackingContext())
    setTrackingContext({ view: 'estaciones' })
    expect(shouldEmit(a, trackedKey('/', getTrackingContext()))).toBe(true)
  })

  it('NO emite al trastear con controles que no cambian ruta/vista/ciudad', () => {
    // hour, metric, bucket, emode... reescriben la URL constantemente.
    // Contarlos como pageviews inflaría las vistas hasta hacerlas inútiles.
    setTrackingContext({ lat: 41.45, lon: 2.25, view: 'resumen' })
    const a = trackedKey('/', getTrackingContext())
    const b = trackedKey('/', getTrackingContext())
    expect(shouldEmit(a, b)).toBe(false)
  })

  it('un movimiento minúsculo dentro de la misma celda no emite', () => {
    setTrackingContext({ lat: 41.4501, lon: 2.2478, view: 'resumen' })
    const a = trackedKey('/', getTrackingContext())
    setTrackingContext({ lat: 41.4509, lon: 2.2472 })
    expect(shouldEmit(a, trackedKey('/', getTrackingContext()))).toBe(false)
  })

  it('cambiar de ruta emite', () => {
    setTrackingContext({ view: 'resumen' })
    const a = trackedKey('/', getTrackingContext())
    expect(shouldEmit(a, trackedKey('/premium', getTrackingContext()))).toBe(true)
  })

  it('la primera emisión (sin clave previa) siempre pasa', () => {
    expect(shouldEmit(null, trackedKey('/', {}))).toBe(true)
  })
})

describe('externalReferrer', () => {
  it('descarta los referentes internos: enlazarse a uno mismo no es una fuente', () => {
    expect(externalReferrer(`${ORIGIN}/premium`, ORIGIN)).toBeUndefined()
  })

  it('conserva los externos', () => {
    expect(externalReferrer('https://google.com/search?q=tiempo', ORIGIN)).toBe('https://google.com/search?q=tiempo')
  })

  it('tolera referente vacío o malformado', () => {
    expect(externalReferrer('', ORIGIN)).toBeUndefined()
    expect(externalReferrer('no-es-url', ORIGIN)).toBeUndefined()
  })
})

describe('buildPageviewPayload', () => {
  const base = { origin: ORIGIN, referrer: '', now: NOW, cid: 'cid123' }

  it('manda lat/lon AUNQUE NO ESTÉN EN LA URL (el bug de "Zonas" vacío)', () => {
    // useUrlState omite lat/lon cuando son los de la ciudad por defecto,
    // así que la ingesta antigua —que los rascaba del query string— no
    // veía jamás la ciudad más visitada.
    setTrackingContext({ lat: 41.45, lon: 2.25, view: 'resumen' })
    const p = buildPageviewPayload({ ...base, href: `${ORIGIN}/`, ctx: getTrackingContext() })
    expect(p?.q).toEqual({ lat: 41.45, lon: 2.25 })
    expect(p?.view).toBe('resumen')
  })

  it('si no hay contexto, cae a las coordenadas de la URL (deep link compartido)', () => {
    const p = buildPageviewPayload({ ...base, href: `${ORIGIN}/?lat=40.4200&lon=-3.7000`, ctx: {} })
    expect(p?.q).toEqual({ lat: 40.42, lon: -3.7 })
  })

  // --- Null Island -------------------------------------------------------
  //
  // `Number(sp.get('lat'))` daba 0 cuando el parámetro no estaba, y
  // `Number.isFinite(0)` es true, así que el guard lo aceptaba y grababa
  // la celda 0.00,0.00: mitad del Atlántico. Como `useUrlState` omite
  // lat/lon cuando son los de la ciudad por defecto, la mayoría de las
  // visitas caían ahí y "océano Atlántico" acabó siendo la ubicación más
  // consultada del panel.
  it('sin contexto NI coordenadas en la URL no inventa la celda 0,0', () => {
    const p = buildPageviewPayload({ ...base, href: `${ORIGIN}/`, ctx: {} })
    expect(p?.q).toBeUndefined()
  })

  it('una URL con query pero sin coordenadas tampoco cae en Null Island', () => {
    const p = buildPageviewPayload({ ...base, href: `${ORIGIN}/?view=map&hour=13`, ctx: {} })
    expect(p?.q).toBeUndefined()
  })

  it('coordenadas vacías o a medias se descartan enteras', () => {
    expect(buildPageviewPayload({ ...base, href: `${ORIGIN}/?lat=&lon=`, ctx: {} })?.q).toBeUndefined()
    // Sólo una de las dos: sin la otra no hay celda que valga.
    expect(buildPageviewPayload({ ...base, href: `${ORIGIN}/?lat=41.45`, ctx: {} })?.q).toBeUndefined()
    expect(buildPageviewPayload({ ...base, href: `${ORIGIN}/?lon=2.25`, ctx: {} })?.q).toBeUndefined()
  })

  it('un 0,0 EXPLÍCITO en la URL sí se respeta: es una coordenada legítima', () => {
    // El arreglo distingue "ausente" de "cero"; no prohíbe el cero.
    const p = buildPageviewPayload({ ...base, href: `${ORIGIN}/?lat=0&lon=0`, ctx: {} })
    expect(p?.q).toEqual({ lat: 0, lon: 0 })
  })

  it('guarda SÓLO el pathname, nunca el query string', () => {
    const p = buildPageviewPayload({
      ...base,
      href: `${ORIGIN}/?lat=41.45&lon=2.25&models=a,b,c&hour=13&metric=temp`,
      ctx: {},
    })
    expect(p?.p).toBe('/')
    expect(JSON.stringify(p)).not.toContain('models')
  })

  it('extrae las UTM y las omite cuando no hay ninguna', () => {
    const conUtm = buildPageviewPayload({
      ...base,
      href: `${ORIGIN}/?utm_source=twitter&utm_medium=social`,
      ctx: {},
    })
    expect(conUtm?.u).toEqual({ s: 'twitter', m: 'social', c: undefined })
    const sinUtm = buildPageviewPayload({ ...base, href: `${ORIGIN}/`, ctx: {} })
    expect(sinUtm?.u).toBeUndefined()
  })

  it('descarta rutas internas', () => {
    for (const p of ['/api/forecast', '/_next/static/x.js', '/manifest.json']) {
      expect(buildPageviewPayload({ ...base, href: `${ORIGIN}${p}`, ctx: {} })).toBeNull()
    }
  })

  it('acota la duración a 30 min: una pestaña abierta toda la noche no es tiempo en página', () => {
    const p = buildPageviewPayload({ ...base, href: `${ORIGIN}/`, ctx: {}, durationMs: 8 * 3_600_000 })
    expect(p?.d).toBe(30 * 60_000)
  })

  it('omite duraciones ausentes o negativas', () => {
    expect(buildPageviewPayload({ ...base, href: `${ORIGIN}/`, ctx: {} })?.d).toBeUndefined()
    expect(buildPageviewPayload({ ...base, href: `${ORIGIN}/`, ctx: {}, durationMs: -5 })?.d).toBeUndefined()
  })

  it('devuelve null ante un href inválido en vez de lanzar', () => {
    expect(buildPageviewPayload({ ...base, href: 'esto no es una url', ctx: {} })).toBeNull()
  })
})

describe('buildEventPayload', () => {
  it('construye un evento con nombre y propiedades', () => {
    const p = buildEventPayload({ name: 'checkout_click', props: { plan: 'premium' }, now: NOW, cid: 'c1' })
    expect(p).toMatchObject({ k: 'ev', n: 'checkout_click', props: { plan: 'premium' } })
  })

  it('descarta propiedades demasiado grandes pero conserva el evento', () => {
    const p = buildEventPayload({
      name: 'x',
      props: { blob: 'y'.repeat(MAX_PROPERTIES_BYTES + 100) },
      now: NOW,
      cid: 'c1',
    })
    expect(p?.n).toBe('x')
    expect(p?.props).toBeUndefined()
  })

  it('rechaza un nombre vacío', () => {
    expect(buildEventPayload({ name: '', now: NOW, cid: 'c1' })).toBeNull()
  })
})

describe('detalles del emisor', () => {
  it('el debounce supera al de useUrlState (300 ms) para no contar una navegación 2-3 veces', () => {
    expect(EMIT_DEBOUNCE_MS).toBeGreaterThan(300)
  })

  it('newCid genera identificadores distintos', () => {
    const ids = new Set(Array.from({ length: 200 }, newCid))
    expect(ids.size).toBe(200)
  })
})
