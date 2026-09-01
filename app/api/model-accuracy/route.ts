import { NextResponse } from 'next/server'
import { rateLimit } from '@/lib/rateLimit'
import { getModelAccuracyByTerrain } from '@/lib/backtest/db'
import { BACKTEST_METRICS, LEAD_TIME_BUCKETS, type TerrainType } from '@/lib/backtest/config'

/**
 * Recomendación de modelos por tipo de terreno, para el cliente.
 *
 * POR QUÉ EXISTE ESTA RUTA. La portada llamaba a
 * `getModelAccuracyByTerrain` DIRECTAMENTE desde un componente
 * `'use client'`. Eso arrastraba `@/lib/backtest/db` → `@/lib/db` →
 * `@libsql/client` al paquete del navegador: 493 KB crudos / 142 KB
 * gzip, el 36% del JS de primera carga.
 *
 * Y no funcionaba. En el navegador `NODE_ENV` es 'production' y
 * `TURSO_DATABASE_URL` no existe (no lleva prefijo `NEXT_PUBLIC_`, así
 * que nunca se inlinea), luego `getDb()` devolvía `null` SIEMPRE y la
 * función salía por su `if (!db) return []`. La recomendación por
 * terreno llevaba desactivada en producción desde que se escribió, y
 * costaba medio megabyte estar sin ella. El fallo era invisible porque
 * el modo degradado —conjunto vacío, ensemble sin ajuste— es
 * exactamente lo que se ve cuando el backtest aún no ha escrito filas.
 *
 * La ruta devuelve sólo los identificadores de modelo, que es lo único
 * que el cliente usa: el resto de `ModelAccuracyRow` (rmse, ventanas,
 * recuentos) se queda en el servidor.
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
  if (!rateLimit(`model-accuracy:${ip}`, 30)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }

  const { searchParams } = new URL(request.url)

  // Lista blanca en los tres parámetros. Van directos a una consulta
  // parametrizada, así que no hay inyección posible, pero validar aquí
  // evita quemar una lectura de Turso —y una entrada de caché de CDN—
  // por cada cadena arbitraria que alguien quiera probar.
  const terrain = searchParams.get('terrain') ?? ''
  if (!TERRENOS.includes(terrain as TerrainType)) {
    return NextResponse.json({ error: 'Invalid terrain' }, { status: 400 })
  }

  const metric = searchParams.get('metric') ?? ''
  if (!(BACKTEST_METRICS as readonly string[]).includes(metric)) {
    return NextResponse.json({ error: 'Invalid metric' }, { status: 400 })
  }

  const buckets = (searchParams.get('buckets') ?? '')
    .split(',')
    .map(b => b.trim())
    .filter(b => (LEAD_TIME_BUCKETS as readonly string[]).includes(b))
  if (buckets.length === 0) {
    return NextResponse.json({ error: 'Invalid buckets' }, { status: 400 })
  }

  try {
    const rows = await getModelAccuracyByTerrain(terrain, metric, buckets, { topN: 5 })
    return NextResponse.json(
      { models: rows.map(r => r.model_id) },
      {
        headers: {
          // `model_accuracy` la reescribe el backtest SEMANAL. Una hora
          // de caché compartida es conservador de sobra, y el
          // stale-while-revalidate de un día hace que ni siquiera el
          // primero de la hora espere.
          'Cache-Control': 'public, max-age=600, s-maxage=3600, stale-while-revalidate=86400',
        },
      }
    )
  } catch {
    // Degradar como degradaba antes: sin recomendación, no roto.
    return NextResponse.json({ models: [] }, { status: 200 })
  }
}
