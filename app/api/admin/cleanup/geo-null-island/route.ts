import { NextResponse } from 'next/server'
import { getCurrentAdmin } from '@/lib/admin/auth'
import { db } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Limpieza puntual de las visitas atribuidas a Null Island.
 *
 * QUÉ PASÓ: `Number(sp.get('lat'))` devuelve 0 cuando el parámetro no
 * está, y `Number.isFinite(0)` es true, así que el guard lo daba por
 * bueno y grababa la celda `0.00,0.00` — mitad del Atlántico. Como
 * `useUrlState` omite lat/lon de la URL cuando coinciden con la
 * ubicación por defecto, la mayoría de las visitas caían ahí y "océano
 * Atlántico" acabó siendo la ubicación más consultada del panel. El
 * origen está corregido; esto sanea lo ya escrito.
 *
 * POR QUÉ NO ES UN EJECUTOR DE SQL: sería la vía más corta, y también
 * convertiría una sesión de administración en ejecución arbitraria
 * contra la base de datos de producción. Esta ruta hace UNA cosa
 * concreta, acotada y auditable.
 *
 * POR QUÉ SE ANULA `geo_cell` EN VEZ DE BORRAR LA FILA: la visita
 * ocurrió de verdad; lo único incorrecto es la ubicación. Borrar la fila
 * restaría vistas y dispositivos reales del panel — justo el problema
 * que se venía arrastrando. `geo_cell` es nullable (la ingesta ya
 * escribe null cuando no hay coordenadas), así que anularla deja la
 * visita intacta y sólo le quita la zona equivocada.
 *
 * `daily_breakdowns` y `geo_names` sí se borran: son filas DERIVADAS de
 * esa celda (el desglose por zona y el nombre cacheado). Los totales de
 * vistas y dispositivos no salen de ahí, sino de `daily_anon_stats`, así
 * que no se pierde ningún recuento.
 *
 * Es idempotente: una segunda pasada no encuentra nada y devuelve ceros.
 */

/** La celda que generaba el bug. Es una coordenada legítima, pero aquí
 *  actúa como centinela: nadie consulta el tiempo en mitad del océano. */
const CELDA = '0.00,0.00'

interface Recuento {
  pageViews: number
  breakdowns: number
  geoNames: number
}

async function contar(): Promise<Recuento> {
  const [pv, bd, gn] = await Promise.all([
    db.selectOrThrow<{ n: number }>(
      'SELECT COUNT(*) AS n FROM page_views WHERE geo_cell = ?',
      [CELDA],
    ),
    db.selectOrThrow<{ n: number }>(
      "SELECT COUNT(*) AS n FROM daily_breakdowns WHERE dim = 'geo_cell' AND label = ?",
      [CELDA],
    ),
    db.selectOrThrow<{ n: number }>('SELECT COUNT(*) AS n FROM geo_names WHERE cell = ?', [CELDA]),
  ])
  return {
    pageViews: Number(pv[0]?.n ?? 0),
    breakdowns: Number(bd[0]?.n ?? 0),
    geoNames: Number(gn[0]?.n ?? 0),
  }
}

/** GET → cuántas filas se verían afectadas, sin tocar nada. */
export async function GET() {
  const admin = await getCurrentAdmin()
  if (!admin) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  try {
    return NextResponse.json({ ok: true, afectadas: await contar() })
  } catch (err) {
    console.error('[cleanup] no se pudo contar Null Island:', err)
    return NextResponse.json({ ok: false, error: 'query_failed' }, { status: 500 })
  }
}

/** POST → aplica la limpieza. */
export async function POST() {
  const admin = await getCurrentAdmin()
  if (!admin) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  try {
    const antes = await contar()

    // En lote: las tres sentencias caen juntas o no cae ninguna. Dejar
    // el desglose borrado y las visitas sin anular (o al revés) daría un
    // panel incoherente.
    await db.batchOrThrow([
      { sql: 'UPDATE page_views SET geo_cell = NULL WHERE geo_cell = ?', args: [CELDA] },
      {
        sql: "DELETE FROM daily_breakdowns WHERE dim = 'geo_cell' AND label = ?",
        args: [CELDA],
      },
      { sql: 'DELETE FROM geo_names WHERE cell = ?', args: [CELDA] },
    ])

    // Traza de auditoría: esto modifica datos de producción.
    // eslint-disable-next-line no-console
    console.log(
      `[cleanup] Null Island saneado por ${admin}: ` +
        `${antes.pageViews} visita(s) sin zona, ${antes.breakdowns} desglose(s) y ` +
        `${antes.geoNames} nombre(s) borrados`,
    )

    return NextResponse.json({ ok: true, aplicado: antes, restante: await contar() })
  } catch (err) {
    console.error('[cleanup] Null Island falló:', err)
    return NextResponse.json({ ok: false, error: 'query_failed' }, { status: 500 })
  }
}
