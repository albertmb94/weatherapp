import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.hoisted(() => {
  process.env.TURSO_DATABASE_URL = 'file::memory:'
  delete process.env.TURSO_AUTH_TOKEN
  process.env.TRACK_INTERNAL_SECRET = 'secreto-de-test'
})

import { POST } from '@/app/api/ingest/route'
import { db } from '@/lib/db'
import { runMigrations } from '@/lib/migrations'
import { dayKey } from '@/lib/analytics/time'

const URL_INGEST = 'https://eltiempo.example/api/ingest'

interface Body {
  k?: string
  cid?: string
  t?: number
  p?: string
  q?: { lat: number; lon: number }
  n?: string
  props?: Record<string, unknown>
  [k: string]: unknown
}

/** Petición tal y como la manda un navegador: identidad en cookies. */
function beacon(body: Body, cookies: Record<string, string>, headers: Record<string, string> = {}): NextRequest {
  const cookie = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ')
  return new NextRequest(URL_INGEST, {
    method: 'POST',
    headers: { 'content-type': 'text/plain;charset=UTF-8', cookie, ...headers },
    body: JSON.stringify(body),
  })
}

/** Petición del proxy Edge: identidad en cabeceras firmadas. */
function interna(body: Body, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(URL_INGEST, {
    method: 'POST',
    headers: {
      'content-type': 'text/plain;charset=UTF-8',
      'x-track-secret': 'secreto-de-test',
      ...headers,
    },
    body: JSON.stringify(body),
  })
}

async function filas(anonId: string) {
  return db.selectOrThrow<{ id: string; path: string; day: string; geo_cell: string | null; session_id: string; country_code: string | null }>(
    'SELECT id, path, day, geo_cell, session_id, country_code FROM page_views WHERE anon_id = ?',
    [anonId],
  )
}

let n = 0
const nuevoAnon = () => `anon${++n}`.padEnd(32, '0')

beforeAll(async () => {
  expect(await db.ensure()).toBe(true)
  const res = await runMigrations()
  expect(res.ok).toBe(true)
})

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('gate de consentimiento', () => {
  it('sin cookie de consentimiento devuelve 204 y NO escribe nada', async () => {
    const anon = nuevoAnon()
    const res = await POST(beacon({ k: 'pv', cid: 'c1', p: '/' }, { wthr_anon: anon }))
    expect(res.status).toBe(204)
    expect(await filas(anon)).toHaveLength(0)
  })

  it('con consentimiento rechazado tampoco escribe', async () => {
    const anon = nuevoAnon()
    const res = await POST(beacon({ k: 'pv', cid: 'c1', p: '/' }, { wthr_anon: anon, wthr_consent: 'rejected' }))
    expect(res.status).toBe(204)
    expect(await filas(anon)).toHaveLength(0)
  })

  it('acepta el valor legacy "accept" (cookies de 365 días aún vivas)', async () => {
    const anon = nuevoAnon()
    const res = await POST(beacon({ k: 'pv', cid: 'c1', p: '/' }, { wthr_anon: anon, wthr_consent: 'accept' }))
    expect(res.status).toBe(200)
    expect(await filas(anon)).toHaveLength(1)
  })
})

describe('identidad', () => {
  it('la COOKIE manda: una cabecera x-anon-id falsificada se ignora', async () => {
    // La ruta antigua aceptaba x-anon-id de cualquiera, así que se podían
    // inventar visitantes a voluntad.
    const real = nuevoAnon()
    const falso = 'falsificado'.padEnd(32, 'f')
    const res = await POST(
      beacon({ k: 'pv', cid: 'c1', p: '/' }, { wthr_anon: real, wthr_consent: 'granted' }, { 'x-anon-id': falso }),
    )
    expect(res.status).toBe(200)
    expect(await filas(real)).toHaveLength(1)
    expect(await filas(falso)).toHaveLength(0)
  })

  it('sin cookie de identidad pero con consentimiento, acuña una y la devuelve', async () => {
    // Caso "acabo de aceptar y aún no he vuelto a pasar por el proxy":
    // sin esto se perdería la primera visita tras el consentimiento.
    const res = await POST(beacon({ k: 'pv', cid: 'nuevo1', p: '/' }, { wthr_consent: 'granted' }))
    expect(res.status).toBe(200)
    expect(res.cookies.get('wthr_anon')?.value).toMatch(/^[0-9a-f]{32}$/)
  })

  it('el camino interno se fía de las cabeceras SÓLO con el secreto correcto', async () => {
    const anon = nuevoAnon()
    const res = await POST(interna({ k: 'pv', cid: 'boot1', p: '/' }, { 'x-anon-id': anon, 'x-session-id': 'sess-boot' }))
    expect(res.status).toBe(200)
    expect(await filas(anon)).toHaveLength(1)
  })

  it('con un secreto equivocado se trata como navegador: sin cookies, 204', async () => {
    const anon = nuevoAnon()
    const req = new NextRequest(URL_INGEST, {
      method: 'POST',
      headers: { 'content-type': 'text/plain', 'x-track-secret': 'secreto-incorrecto', 'x-anon-id': anon },
      body: JSON.stringify({ k: 'pv', cid: 'x', p: '/' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(204)
    expect(await filas(anon)).toHaveLength(0)
  })
})

describe('deduplicación', () => {
  it('el mismo cid dos veces produce UNA sola fila', async () => {
    const anon = nuevoAnon()
    const body = { k: 'pv', cid: 'repetido', p: '/' }
    await POST(beacon(body, { wthr_anon: anon, wthr_consent: 'granted' }))
    await POST(beacon(body, { wthr_anon: anon, wthr_consent: 'granted' }))
    expect(await filas(anon)).toHaveLength(1)
  })

  it('el mismo cid de DOS dispositivos distintos produce dos filas', async () => {
    // El id se hashea con el anon_id que conoce el servidor: si se usara
    // el cid crudo como clave, un cliente podría reservar ids y suprimir
    // los pageviews de otras personas.
    const a = nuevoAnon()
    const b = nuevoAnon()
    const body = { k: 'pv', cid: 'colision', p: '/' }
    await POST(beacon(body, { wthr_anon: a, wthr_consent: 'granted' }))
    await POST(beacon(body, { wthr_anon: b, wthr_consent: 'granted' }))
    expect(await filas(a)).toHaveLength(1)
    expect(await filas(b)).toHaveLength(1)
  })

  it('sin cid se rechaza', async () => {
    const res = await POST(beacon({ k: 'pv', p: '/' }, { wthr_anon: nuevoAnon(), wthr_consent: 'granted' }))
    expect(res.status).toBe(400)
  })
})

describe('rate limit', () => {
  it('un dispositivo abusivo NO consume la cuota de los demás', async () => {
    // El bug: la clave era `x-forwarded-for`, que el fetch interno del
    // proxy no mandaba, así que TODO el sitio compartía un único bucket
    // de 120/min y el exceso se descartaba en silencio.
    const abusivo = nuevoAnon()
    const normal = nuevoAnon()
    let limitado = 0
    for (let i = 0; i < 100; i++) {
      const r = await POST(beacon({ k: 'pv', cid: `f${i}`, p: '/' }, { wthr_anon: abusivo, wthr_consent: 'granted' }))
      if (r.status === 429) limitado++
    }
    expect(limitado).toBeGreaterThan(0) // el abusivo sí se limita

    const r = await POST(beacon({ k: 'pv', cid: 'ok', p: '/' }, { wthr_anon: normal, wthr_consent: 'granted' }))
    expect(r.status).toBe(200)
    expect(await filas(normal)).toHaveLength(1)
  })
})

describe('sesión', () => {
  it('emite cookie de sesión deslizante de 30 min, no de 24 h', async () => {
    const res = await POST(beacon({ k: 'pv', cid: 's1', p: '/' }, { wthr_anon: nuevoAnon(), wthr_consent: 'granted' }))
    expect(res.cookies.get('wthr_session')?.maxAge).toBe(1800)
    expect(res.cookies.get('wthr_session_seen')?.maxAge).toBe(1800)
  })

  it('mantiene la sesión si la actividad es reciente', async () => {
    const anon = nuevoAnon()
    const res = await POST(
      beacon({ k: 'pv', cid: 's2', p: '/' }, {
        wthr_anon: anon,
        wthr_consent: 'granted',
        wthr_session: 'sesion-viva',
        wthr_session_seen: String(Date.now() - 60_000),
      }),
    )
    expect(res.cookies.get('wthr_session')?.value).toBe('sesion-viva')
    expect((await filas(anon))[0]?.session_id).toBe('sesion-viva')
  })

  it('ROTA la sesión tras 31 min de inactividad', async () => {
    const anon = nuevoAnon()
    const res = await POST(
      beacon({ k: 'pv', cid: 's3', p: '/' }, {
        wthr_anon: anon,
        wthr_consent: 'granted',
        wthr_session: 'sesion-caduca',
        wthr_session_seen: String(Date.now() - 31 * 60_000),
      }),
    )
    const nueva = res.cookies.get('wthr_session')?.value
    expect(nueva).toBeTruthy()
    expect(nueva).not.toBe('sesion-caduca')
  })
})

describe('contenido de la fila', () => {
  it('guarda el pathname sin query y la celda geográfica', async () => {
    const anon = nuevoAnon()
    await POST(
      beacon({ k: 'pv', cid: 'row1', p: '/premium', q: { lat: 41.4501, lon: 2.2478 } },
        { wthr_anon: anon, wthr_consent: 'granted' }),
    )
    const [row] = await filas(anon)
    expect(row.path).toBe('/premium')
    expect(row.geo_cell).toBe('41.45,2.25')
  })

  it('resuelve el día en hora de MADRID, no en UTC', async () => {
    // Hay que mover el reloj del sistema, no mandar un `t` antiguo: la
    // guarda de desfase descarta cualquier timestamp de cliente que se
    // aleje más de 5 min del servidor (ver el test de abajo).
    const instante = Date.UTC(2026, 5, 1, 22, 30) // 00:30 del día 2 en Madrid
    vi.useFakeTimers()
    vi.setSystemTime(instante)
    try {
      const anon = nuevoAnon()
      await POST(beacon({ k: 'pv', cid: 'tz1', p: '/' }, { wthr_anon: anon, wthr_consent: 'granted' }))
      const [row] = await filas(anon)
      expect(row.day).toBe('2026-06-02')
      // El código viejo agrupaba con strftime(...,'unixepoch') = UTC y
      // habría metido esta visita en el día anterior.
      expect(new Date(instante).toISOString().slice(0, 10)).toBe('2026-06-01')
      expect(row.day).toBe(dayKey(instante))
    } finally {
      vi.useRealTimers()
    }
  })

  it('guarda el país REAL de la cabecera del edge, no el idioma', async () => {
    const anon = nuevoAnon()
    await POST(
      beacon({ k: 'pv', cid: 'row2', p: '/' }, { wthr_anon: anon, wthr_consent: 'granted' },
        { 'x-vercel-ip-country': 'fr' }),
    )
    expect((await filas(anon))[0]?.country_code).toBe('FR')
  })

  it('descarta rutas internas', async () => {
    const anon = nuevoAnon()
    const res = await POST(beacon({ k: 'pv', cid: 'row3', p: '/api/forecast' }, { wthr_anon: anon, wthr_consent: 'granted' }))
    expect(res.status).toBe(200)
    expect(await filas(anon)).toHaveLength(0)
  })

  it('un timestamp de cliente absurdo se sustituye por la hora del servidor', async () => {
    // La ruta antigua confiaba en `ts` sin límite: se podían fechar
    // visitas en cualquier punto del pasado.
    const anon = nuevoAnon()
    await POST(
      beacon({ k: 'pv', cid: 'row4', p: '/', t: Date.UTC(2001, 0, 1) }, { wthr_anon: anon, wthr_consent: 'granted' }),
    )
    expect((await filas(anon))[0]?.day).toBe(dayKey(Date.now()))
  })
})

describe('eventos', () => {
  it('registra un evento con nombre y propiedades', async () => {
    const anon = nuevoAnon()
    const res = await POST(
      beacon({ k: 'ev', cid: 'e1', n: 'checkout_click', props: { plan: 'premium' } },
        { wthr_anon: anon, wthr_consent: 'granted' }),
    )
    expect(res.status).toBe(200)
    const rows = await db.selectOrThrow<{ name: string; properties: string }>(
      'SELECT name, properties FROM events WHERE anon_id = ?', [anon],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('checkout_click')
    expect(JSON.parse(rows[0].properties)).toEqual({ plan: 'premium' })
  })
})

describe('robustez', () => {
  it('rechaza cuerpos que no son JSON', async () => {
    const req = new NextRequest(URL_INGEST, {
      method: 'POST',
      headers: { 'content-type': 'text/plain', cookie: 'wthr_consent=granted; wthr_anon=' + nuevoAnon() },
      body: 'no soy json',
    })
    expect((await POST(req)).status).toBe(400)
  })

  it('rechaza cuerpos desmesurados', async () => {
    const res = await POST(
      beacon({ k: 'ev', cid: 'big', n: 'x', relleno: 'z'.repeat(5000) },
        { wthr_anon: nuevoAnon(), wthr_consent: 'granted' }),
    )
    expect(res.status).toBe(413)
  })
})
