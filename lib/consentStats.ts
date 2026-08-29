/**
 * Emisor de la tasa de aceptación del banner.
 *
 * QUÉ SE PUEDE MEDIR AQUÍ Y QUÉ NO
 *
 * Esto cuenta a gente que todavía NO ha consentido, así que no puede
 * usar nada del sistema de analítica: ni cookie, ni identidad, ni
 * sesión. Sólo dispara un contador agregado por día en el servidor. Sin
 * escribir ni leer nada en el dispositivo y sin identificador, no hay
 * dato personal — que es lo único que permite medir esto legítimamente.
 *
 * IMPLICACIÓN QUE HAY QUE ASUMIR: no se puede deduplicar por persona.
 * `shown` son IMPRESIONES; quien ignore el banner cinco veces cuenta
 * cinco. La tasa es "aceptaciones por impresión" y así se etiqueta en el
 * panel. Cualquier otra lectura se estaría inventando un denominador.
 */

export type EventoConsentimiento = 'shown' | 'accept' | 'reject'

export const CONSENT_STATS_PATH = '/api/consent-stats'

/**
 * Una sola emisión de cada tipo por carga de página.
 *
 * Vive en el módulo y no en un ref porque el banner puede montarse y
 * desmontarse (React StrictMode monta dos veces en desarrollo), y cada
 * montaje extra sería una impresión falsa que hunde la tasa.
 */
const emitidos = new Set<EventoConsentimiento>()

/** Sólo para tests: olvida lo ya emitido en esta carga. */
export function resetConsentStats(): void {
  emitidos.clear()
}

export function registrarEventoConsentimiento(evento: EventoConsentimiento): void {
  if (typeof window === 'undefined') return
  if (emitidos.has(evento)) return
  emitidos.add(evento)

  const cuerpo = JSON.stringify({ e: evento })

  // AQUÍ NO SE USA `navigator.sendBeacon`, Y ES DELIBERADO.
  //
  // El beacon es lo que usa el resto del proyecto porque sobrevive a la
  // descarga de la página, pero SIEMPRE manda las cookies del origen y no
  // hay forma de desactivarlo. En el momento de pulsar "Aceptar" ya
  // existe `wthr_consent`, y poco después `wthr_anon`: con beacon, esta
  // ruta —cuya razón de ser es contar SIN identidad— acabaría recibiendo
  // el identificador del dispositivo. Que el servidor no lo lea no basta:
  // la garantía tiene que estar en lo que se envía, no en la buena fe de
  // quien lo reciba.
  //
  // Se pierde poco: estos eventos ocurren con la página viva (pintar el
  // banner, pulsar un botón), no al abandonarla, así que no hace falta la
  // entrega en descarga que justifica el beacon. `keepalive` cubre el
  // caso raro de que alguien cierre justo después.
  try {
    void fetch(CONSENT_STATS_PATH, {
      method: 'POST',
      headers: { 'content-type': 'text/plain;charset=UTF-8' },
      body: cuerpo,
      credentials: 'omit',
      keepalive: true,
    }).catch(() => {})
  } catch {
    /* sin red: la métrica es best-effort, nunca bloquea el banner */
  }
}
