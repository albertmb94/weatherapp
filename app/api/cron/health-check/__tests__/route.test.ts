import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Vigilancia diaria del despliegue.
 *
 * POR QUÉ EXISTE ESTA RUTA. `/api/health` sólo hablaba cuando alguien lo
 * abría, y su único consumidor era el panel de admin: el endpoint que se
 * construyó PARA QUE EL INCIDENTE DEL CRON NO SE REPITIERA dependía de
 * que un humano se acordara de mirarlo. Aquel incidente —`CRON_SECRET`
 * sin definir, cuatro días de analítica sin consolidar— se habría
 * avisado solo el primer día.
 *
 * Lo que estos tests protegen es lo que hace que la alerta SIRVA: que no
 * mande correos cuando todo está bien (un aviso diario acaba siendo un
 * aviso que nadie abre) y que sí los mande cuando falla algo de lo que
 * de verdad se vigila.
 */

const salud = vi.hoisted(() => ({ resultado: { ok: true, checks: {} as Record<string, { ok: boolean; detail?: string }> } }))
const correos = vi.hoisted(() => ({ enviados: [] as { to: string; subject?: string; html?: string }[] }))

vi.mock('@/lib/health', () => ({
  comprobarSalud: () => Promise.resolve(salud.resultado),
}))
vi.mock('@/lib/emails', () => ({
  sendEmail: (opts: { to: string; subject?: string; html?: string }) => {
    correos.enviados.push(opts)
    return Promise.resolve({ ok: true })
  },
}))

const { GET } = await import('../route')

function pedir(auth?: string): Request {
  return new Request('http://localhost/api/cron/health-check', {
    headers: auth ? { authorization: auth } : {},
  })
}

const ENV = { ...process.env }

describe('/api/cron/health-check', () => {
  beforeEach(() => {
    correos.enviados.length = 0
    process.env.CRON_SECRET = 'secreto'
    process.env.ADMIN_EMAIL = 'admin@ejemplo.test'
    salud.resultado = { ok: true, checks: {} }
  })
  afterEach(() => {
    process.env = { ...ENV }
  })

  it('sin CRON_SECRET responde 503, no 200 en silencio', async () => {
    delete process.env.CRON_SECRET
    // Es el fallo exacto que motivó todo esto: Vercel sólo manda la
    // cabecera cuando la variable existe, así que sin ella el cron nunca
    // llega a ejecutarse. Tiene que ser visible, no silencioso.
    const res = await GET(pedir('Bearer secreto') as never)
    expect(res.status).toBe(503)
  })

  it('rechaza sin autorización', async () => {
    expect((await GET(pedir() as never)).status).toBe(401)
    expect((await GET(pedir('Bearer otro') as never)).status).toBe(401)
  })

  it('TODO BIEN: no manda ningún correo', async () => {
    salud.resultado = {
      ok: true,
      checks: { db: { ok: true }, schema: { ok: true }, cron: { ok: true }, openmeteo: { ok: true } },
    }
    const res = await GET(pedir('Bearer secreto') as never)
    const body = (await res.json()) as { alerted: boolean }
    expect(res.status).toBe(200)
    expect(body.alerted).toBe(false)
    expect(correos.enviados).toHaveLength(0)
  })

  it('NO alerta por resend/stripe, que reportan ok:false estando bien', async () => {
    // `checks.resend` y `checks.stripe` valen `ok:false` incluso
    // funcionando: sólo informan de si están configurados. Vigilarlos
    // generaría una alerta diaria garantizada y el aviso dejaría de
    // significar nada.
    salud.resultado = {
      ok: true,
      checks: {
        db: { ok: true },
        openmeteo: { ok: true },
        resend: { ok: false, detail: 'disabled' },
        stripe: { ok: false, detail: 'disabled' },
        clientErrors: { ok: false, detail: '1 distinto(s)' },
      },
    }
    const res = await GET(pedir('Bearer secreto') as never)
    expect((await res.json() as { alerted: boolean }).alerted).toBe(false)
    expect(correos.enviados).toHaveLength(0)
  })

  it('sí alerta cuando falla el cron o el esquema', async () => {
    // Los dos fallos silenciosos que ya han pasado: migraciones
    // pendientes hacen que se registren "cero visitas", y un cron caído
    // no se nota hasta que faltan días de datos.
    salud.resultado = {
      ok: true,
      checks: {
        db: { ok: true },
        openmeteo: { ok: true },
        schema: { ok: false, detail: 'v7/v8 · 1 pendiente(s)' },
        cron: { ok: false, detail: 'CRON_SECRET sin definir' },
      },
    }
    const res = await GET(pedir('Bearer secreto') as never)
    const body = (await res.json()) as { alerted: boolean; problemas: string[] }
    expect(body.alerted).toBe(true)
    expect(body.problemas).toHaveLength(2)
    expect(correos.enviados).toHaveLength(1)
    expect(correos.enviados[0].to).toBe('admin@ejemplo.test')
    expect(correos.enviados[0].html).toContain('1 pendiente(s)')
  })

  it('sin ADMIN_EMAIL falla ruidosamente en vez de callarse', async () => {
    delete process.env.ADMIN_EMAIL
    salud.resultado = { ok: false, checks: { db: { ok: false, detail: 'down' } } }
    const res = await GET(pedir('Bearer secreto') as never)
    expect(res.status).toBe(500)
    expect((await res.json() as { error: string }).error).toBe('admin_email_not_configured')
  })

  it('escapa el HTML del detalle', async () => {
    salud.resultado = { ok: false, checks: { db: { ok: false, detail: '<img onerror=x>' } } }
    await GET(pedir('Bearer secreto') as never)
    expect(correos.enviados[0].html).not.toContain('<img')
    expect(correos.enviados[0].html).toContain('&lt;img')
  })
})
