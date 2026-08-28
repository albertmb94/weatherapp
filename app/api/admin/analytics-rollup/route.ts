import { NextResponse } from 'next/server'
import { getCurrentAdmin } from '@/lib/admin/auth'
import { runAnalyticsRollup } from '@/lib/analytics'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Ejecución manual del rollup nocturno de analítica.
 *
 * POR QUÉ EXISTE
 *
 * `/api/cron/analytics-rollup` sólo acepta el bearer de `CRON_SECRET`,
 * que es el mecanismo correcto para Vercel Cron pero inútil para operar:
 * obliga a sacar el secreto de las variables de entorno y pegarlo en una
 * terminal cada vez que hace falta mirar o forzar algo.
 *
 * Esa asimetría tuvo consecuencias. Las migraciones sí se podían
 * inspeccionar y forzar desde el panel (/api/admin/migrate), pero el
 * rollup no; cuando `CRON_SECRET` no llegó a definirse en producción, la
 * consolidación estuvo CUATRO DÍAS sin ejecutarse y no había forma de
 * lanzarla desde el panel ni de comprobarla sin credenciales.
 *
 * Aquí la autorización es la SESIÓN DE ADMIN, no el secreto del cron:
 * son dos llamadores distintos (la plataforma y una persona) y cada uno
 * usa su propia credencial. `CRON_SECRET` no interviene, así que este
 * botón funciona incluso cuando la variable falta — que es justo cuando
 * más se necesita.
 *
 * El rollup es idempotente y consolida TODOS los días pendientes dentro
 * de la retención, así que ejecutarlo de más no rompe nada ni duplica
 * datos. El purgado sigue condicionado a que la consolidación se
 * verifique: esta ruta no relaja esa garantía.
 */
export async function POST() {
  const admin = await getCurrentAdmin()
  if (!admin) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  const res = await runAnalyticsRollup()

  if (!res.ok) {
    console.error(`[analytics] rollup manual fallido (${admin}):`, res.reason)
    return NextResponse.json(res, { status: 500 })
  }

  // Traza de auditoría: el rollup PURGA datos crudos, así que conviene
  // saber quién lo lanzó a mano y qué se llevó por delante.
  // eslint-disable-next-line no-console
  console.log(
    `[analytics] rollup manual por ${admin}: ${res.days ?? 0} día(s) consolidados, ` +
      `${res.purgedViews ?? 0} vistas purgadas`,
  )
  return NextResponse.json(res)
}
