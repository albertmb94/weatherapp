import { NextResponse } from 'next/server'
import { rateLimit } from '@/lib/rateLimit'
import { getBiasByTerrain } from '@/lib/backtest/db'
import { BACKTEST_METRICS, LEAD_TIME_BUCKETS, type TerrainType } from '@/lib/backtest/config'

/**
 * Corrección de sesgo del ensemble, por tipo de terreno (Fase 3).
 *
 * POR QUÉ EXISTE (mismo motivo que `/api/model-accuracy`): los
 * consumidores del ensemble (`friendlyForecast`, `InsightsTable`,
 * `DailySummary`) son componentes `'use client'`. Leer
 * `model_accuracy` desde ahí arrastraría `@libsql/client` al bundle y,
 * en el navegador, `getDb()` devuelve null y la corrección nunca
 * ocurriría. La ruta agrega el sesgo en el servidor y sólo manda el
 * mapa que el cliente necesita: metric → bucket → model → bias.
 *
 * Sin filas medidas (o sin DB) responde `{ bias: {} }` y el ensemble
 * queda exactamente como estaba: degradación silenciosa, no rotura.
 */

export const runtime = 'nodejs'

/** Los seis valores que produce `classifyTerrain`. */
const TERRENOS: readonly TerrainType[] = [
  'coastal',
  'mountain',
  'urban',
  'flat',
  'island',
  'river_valley',
]

export async function GET(request: Request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (!rateLimit(`model-bias:${ip}`, 30)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }

  const { searchParams } = new URL(request.url)
  const terrain = searchParams.get('terrain') ?? ''
  if (!TERRENOS.includes(terrain as TerrainType)) {
    return NextResponse.json({ error: 'Invalid terrain' }, { status: 400 })
  }

  try {
    const bias = await getBiasByTerrain(terrain, BACKTEST_METRICS, LEAD_TIME_BUCKETS)
    return NextResponse.json(
      { terrain, bias },
      {
        headers: {
          // `model_accuracy` la reescribe el backtest SEMANAL; una hora
          // de caché compartida sobra y el stale-while-revalidate de un
          // día hace que ni el primero de la hora espere.
          'Cache-Control': 'public, max-age=600, s-maxage=3600, stale-while-revalidate=86400',
        },
      }
    )
  } catch {
    // Degradar a "sin corrección", no romper el ensemble.
    return NextResponse.json({ terrain, bias: {} }, { status: 200 })
  }
}
