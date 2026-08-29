import { NextRequest, NextResponse } from 'next/server'
import { getCurrentAdmin } from '@/lib/admin/auth'
import { db } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Quita la atribución de zona de una celda geográfica concreta.
 *
 * PARA QUÉ: retirar del panel una zona que no representa tráfico real —
 * el caso que lo motivó fue Null Island, y el segundo, tráfico de
 * pruebas contra producción. Ambos ensucian el desglose de ciudades sin
 * que se pueda distinguir de visitas legítimas.
 *
 * (Null Island: `Number(sp.get('lat'))` devuelve 0 cuando el parámetro
 * no está y `Number.isFinite(0)` es true, así que el guard lo daba por
 * bueno y grababa la celda 0.00,0.00 — mitad del Atlántico. El origen
 * está corregido; esto sanea lo ya escrito.)
 *
 * POR QUÉ NO ES UN EJECUTOR DE SQL: sería la vía más corta, y también
 * convertiría una sesión de administración en ejecución arbitraria
 * contra la base de datos de producción. Aquí hay UNA operación fija; lo
 * único variable es QUÉ celda, y llega como parámetro validado contra un
 * formato estricto, nunca interpolado en el SQL.
 *
 * POR QUÉ SE ANULA `geo_cell` EN VEZ DE BORRAR LA FILA: la visita
 * ocurrió; lo único que se retira es la ubicación. Borrar la fila
 * restaría vistas y dispositivos reales del panel — justo el problema
 * que se venía arrastrando. `geo_cell` es nullable (la ingesta ya
 * escribe null cuando no hay coordenadas), así que anularla deja la
 * visita intacta.
 *
 * `daily_breakdowns` y `geo_names` sí se borran: son filas DERIVADAS de
 * esa celda. Los totales de vistas y dispositivos salen de
 * `daily_anon_stats`, así que no se pierde ningún recuento.
 *
 * Es idempotente: una segunda pasada no encuentra nada y devuelve ceros.
 */

/** La celda del bug de Null Island. Es la que se limpia por defecto. */
export const CELDA_NULL_ISLAND = '0.00,0.00'

/**
 * Formato exacto que escribe la ingesta: `lat.toFixed(2),lon.toFixed(2)`.
 * Se valida con una expresión estricta y ADEMÁS por rango, para que el
 * parámetro no pueda ser otra cosa que una celda real.
 */
const FORMATO = /^-?\d{1,2}\.\d{2},-?\d{1,3}\.\d{2}$/

function celdaValida(raw: string | null | undefined): string | null {
  if (!raw || !FORMATO.test(raw)) return null
  const [lat, lon] = raw.split(',').map(Number)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null
  return raw
}

interface Recuento {
  pageViews: number
  breakdowns: number
  geoNames: number
}

async function contar(celda: string): Promise<Recuento> {
  const [pv, bd, gn] = await Promise.all([
    db.selectOrThrow<{ n: number }>('SELECT COUNT(*) AS n FROM page_views WHERE geo_cell = ?', [
      celda,
    ]),
    db.selectOrThrow<{ n: number }>(
      "SELECT COUNT(*) AS n FROM daily_breakdowns WHERE dim = 'geo_cell' AND label = ?",
      [celda],
    ),
    db.selectOrThrow<{ n: number }>('SELECT COUNT(*) AS n FROM geo_names WHERE cell = ?', [celda]),
  ])
  return {
    pageViews: Number(pv[0]?.n ?? 0),
    breakdowns: Number(bd[0]?.n ?? 0),
    geoNames: Number(gn[0]?.n ?? 0),
  }
}

/** GET [?cell=lat,lon] → cuántas filas se verían afectadas, sin tocar nada. */
export async function GET(req: NextRequest) {
  const admin = await getCurrentAdmin()
  if (!admin) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  const bruta = req.nextUrl.searchParams.get('cell') ?? CELDA_NULL_ISLAND
  const celda = celdaValida(bruta)
  if (!celda) {
    return NextResponse.json({ ok: false, error: 'celda_invalida' }, { status: 400 })
  }

  try {
    return NextResponse.json({ ok: true, cell: celda, afectadas: await contar(celda) })
  } catch (err) {
    console.error('[cleanup] no se pudo contar la celda:', err)
    return NextResponse.json({ ok: false, error: 'query_failed' }, { status: 500 })
  }
}

/** POST [?cell=lat,lon] → aplica la limpieza. */
export async function POST(req: NextRequest) {
  const admin = await getCurrentAdmin()
  if (!admin) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  const bruta = req.nextUrl.searchParams.get('cell') ?? CELDA_NULL_ISLAND
  const celda = celdaValida(bruta)
  if (!celda) {
    return NextResponse.json({ ok: false, error: 'celda_invalida' }, { status: 400 })
  }

  try {
    const antes = await contar(celda)

    // En lote: las tres sentencias caen juntas o no cae ninguna. Dejar el
    // desglose borrado y las visitas sin anular (o al revés) daría un
    // panel incoherente.
    await db.batchOrThrow([
      { sql: 'UPDATE page_views SET geo_cell = NULL WHERE geo_cell = ?', args: [celda] },
      { sql: "DELETE FROM daily_breakdowns WHERE dim = 'geo_cell' AND label = ?", args: [celda] },
      { sql: 'DELETE FROM geo_names WHERE cell = ?', args: [celda] },
    ])

    // Traza de auditoría: esto modifica datos de producción.
    // eslint-disable-next-line no-console
    console.log(
      `[cleanup] celda ${celda} saneada por ${admin}: ` +
        `${antes.pageViews} visita(s) sin zona, ${antes.breakdowns} desglose(s) y ` +
        `${antes.geoNames} nombre(s) borrados`,
    )

    return NextResponse.json({ ok: true, cell: celda, aplicado: antes, restante: await contar(celda) })
  } catch (err) {
    console.error('[cleanup] la limpieza de celda falló:', err)
    return NextResponse.json({ ok: false, error: 'query_failed' }, { status: 500 })
  }
}
