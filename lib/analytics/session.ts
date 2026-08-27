/**
 * Rotación de sesión anónima.
 *
 * El proxy calculaba `isNewSession` con una ventana de inactividad de 30
 * min... y luego no lo usaba para nada: el id de sesión se reutilizaba
 * siempre y la cookie se re-emitía con maxAge 86400 en cada petición,
 * convirtiéndola en una cookie rodante que nunca caduca para un
 * visitante activo. Consecuencias en cadena:
 *
 *   - la tabla sessions tenía UNA fila por dispositivo, no por sesión.
 *   - el KPI "Sesiones hoy" (WHERE started_at >= hoy) sólo contaba a
 *     quien hizo su PRIMERA visita de la historia hoy, casi siempre 0.
 *   - COUNT(DISTINCT session_id) en el rollup daba 1 para todo
 *     visitante recurrente, para siempre.
 *
 * Aquí la rotación ocurre de verdad. Función pura para poder testear las
 * fronteras sin navegador ni BD, y compartida por el runtime Edge
 * (proxy) y Node (ingesta): cada uno pasa su propio generador de ids
 * porque Web Crypto y node:crypto no son la misma API.
 */

export const SESSION_TTL_MS = 30 * 60_000

export interface ResolvedSession {
  sessionId: string
  /** true si esta petición ABRE una sesión nueva. */
  isNew: boolean
}

/**
 * @param prevId    Valor de la cookie de sesión, si lo hay.
 * @param lastSeen  Timestamp de la última actividad (cookie _seen).
 * @param now       Instante actual.
 * @param newId     Generador de id, específico del runtime.
 */
export function resolveSession(
  prevId: string | undefined | null,
  lastSeen: number,
  now: number,
  newId: () => string,
): ResolvedSession {
  // Sin id previo, o con un lastSeen ausente/corrupto, abrimos sesión.
  // Fail-safe deliberado: preferimos contar una sesión de más a arrastrar
  // un id indefinidamente por culpa de una cookie a medio escribir.
  if (!prevId || !Number.isFinite(lastSeen) || lastSeen <= 0) {
    return { sessionId: newId(), isNew: true }
  }
  const idle = now - lastSeen
  // idle negativo = reloj del cliente adelantado respecto al servidor.
  // No es motivo para romper la sesión: se trata como actividad reciente.
  if (idle > SESSION_TTL_MS) {
    return { sessionId: newId(), isNew: true }
  }
  return { sessionId: prevId, isNew: false }
}
