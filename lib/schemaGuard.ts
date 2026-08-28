/**
 * Memoización de creación de esquema, con UNA sola regla:
 * **el resultado se cachea sólo cuando es `true`**. Cualquier fallo —
 * BD no disponible, DDL que lanza, promesa rechazada — libera el memo
 * para que la siguiente llamada reintente.
 *
 * Auditoría S3: existían 14 copias artesanales de este patrón y 12 de
 * ellas compartían el mismo fallo, la rama
 *
 *     schemaReady = db.ensure().then(ok => {
 *       if (!ok) return false        // ← cachea un Promise<false> ETERNO
 *
 * El `.catch()` final sí anulaba `schemaReady`, pero esa rama no. Basta
 * un corte de un segundo de Turso durante un arranque en frío para que
 * el módulo quede muerto durante toda la vida de esa instancia. En
 * `lib/admin/auth.ts` eso significaba `validateAdminSession` → null en
 * cada petición: login imposible y rebote a /admin/login en bucle hasta
 * reciclar la lambda, sin ningún error visible.
 *
 * `lib/plans.ts` y `lib/appState.ts` ya lo hacían bien; este helper
 * generaliza su comportamiento para que no vuelva a divergir.
 */

import { db } from './db'

/**
 * @param name    Etiqueta para los logs (p. ej. 'admin', 'analytics').
 * @param create  Crea las tablas/índices/seeds. Puede lanzar: se trata
 *                como fallo reintentable, no como estado permanente.
 */
export function memoizeSchema(
  name: string,
  create: () => Promise<void>,
): () => Promise<boolean> {
  let ready: Promise<boolean> | null = null

  return function ensureSchema(): Promise<boolean> {
    if (ready) return ready
    ready = (async () => {
      if (!(await db.ensure())) return false
      await create()
      return true
    })()
      .then(ok => {
        // Importante: para cuando este callback corre, la asignación de
        // `ready` de arriba ya se ha completado, así que anularlo aquí
        // libera de verdad el memo.
        if (!ok) ready = null
        return ok
      })
      .catch(err => {
        console.error(`[schema:${name}] creación fallida:`, err instanceof Error ? err.message : err)
        ready = null
        return false
      })
    return ready
  }
}
