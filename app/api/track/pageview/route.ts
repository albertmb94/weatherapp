import { NextRequest, NextResponse } from 'next/server'
import { POST as ingest } from '@/app/api/ingest/route'

/**
 * RUTA OBSOLETA — se elimina en el siguiente despliegue.
 *
 * La ingesta vive ahora en /api/ingest. Este fichero sigue aquí sólo
 * para cubrir la ventana del despliegue: un worker Edge del deploy
 * ANTERIOR puede seguir vivo unos segundos y disparar su
 * `fetch('/api/track/pageview')` contra el código nuevo. Si esto fuese
 * un 404, esas visitas se perderían.
 *
 * Traduce el payload antiguo (plano, con la identidad en cabeceras
 * x-anon-id / x-session-id) al nuevo y delega. Se marca como interno con
 * TRACK_INTERNAL_SECRET porque el fetch del proxy no lleva cookies, que
 * es de donde la ruta nueva saca la identidad en el camino de navegador.
 *
 * La ruta hermana /api/track/events se ha borrado directamente: no tuvo
 * un solo llamador en toda su vida y su tabla nunca llegó a crearse.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface LegacyPayload {
  path?: string
  referrer?: string
  utm_source?: string
  utm_medium?: string
  utm_campaign?: string
  country?: string
  device?: string
  browser?: string
  os?: string
  ts?: number
}

export async function POST(req: NextRequest) {
  const secret = process.env.TRACK_INTERNAL_SECRET
  if (!secret) {
    return NextResponse.json({ ok: false, reason: 'ingest_not_configured' }, { status: 503 })
  }

  let legacy: LegacyPayload
  try {
    legacy = (await req.json()) as LegacyPayload
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 })
  }

  const rawPath = String(legacy.path ?? '')
  const [pathname, search = ''] = rawPath.split('?')
  // El payload viejo no traía lat/lon: se rascaban del query string en el
  // servidor. Aquí se replica esa lectura para no perder la celda.
  let q: { lat: number; lon: number } | undefined
  if (search) {
    const sp = new URLSearchParams(search)
    const lat = Number(sp.get('lat'))
    const lon = Number(sp.get('lon'))
    if (Number.isFinite(lat) && Number.isFinite(lon)) q = { lat, lon }
  }

  const forwarded = new NextRequest(new URL('/api/ingest', req.url), {
    method: 'POST',
    headers: {
      'content-type': 'text/plain;charset=UTF-8',
      'x-track-secret': secret,
      'x-anon-id': req.headers.get('x-anon-id') ?? '',
      'x-session-id': req.headers.get('x-session-id') ?? '',
      'x-forwarded-for': req.headers.get('x-forwarded-for') ?? '',
    },
    body: JSON.stringify({
      k: 'pv',
      src: 'bootstrap',
      // El formato viejo no tenía id de deduplicación.
      cid: `legacy-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
      t: typeof legacy.ts === 'number' ? legacy.ts : Date.now(),
      p: pathname || '/',
      q,
      r: legacy.referrer,
      u: { s: legacy.utm_source, m: legacy.utm_medium, c: legacy.utm_campaign },
      device: legacy.device,
      browser: legacy.browser,
      os: legacy.os,
    }),
  })

  return ingest(forwarded)
}
