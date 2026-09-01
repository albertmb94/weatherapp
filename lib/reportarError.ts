/**
 * Envío de errores de cliente al servidor.
 *
 * POR QUÉ IMPORTA. La única captura de errores de cliente del proyecto
 * eran `console.error`, o sea, la consola de la persona afectada, donde
 * nadie los ve. Un fallo que reventara la portada a un tercio de los
 * visitantes era invisible hasta que alguien se quejaba: así se
 * detectaron el problema de hidratación y el del seguimiento.
 *
 * ESTE MÓDULO NO PUEDE FALLAR NI BLOQUEAR. Se ejecuta cuando la
 * aplicación ya está rota; cualquier excepción aquí se comería el
 * fallback de error y dejaría la pantalla en blanco.
 */

export const CLIENT_ERRORS_PATH = '/api/client-errors'

/**
 * Huellas ya enviadas EN ESTA CARGA.
 *
 * Vive en el módulo, no en un ref: un error dentro de un bucle de
 * render se dispara muchas veces y React StrictMode monta dos veces en
 * desarrollo. Sin esto, un solo fallo generaría una petición por
 * fotograma. El servidor también agrupa, pero el tráfico se ahorra aquí.
 */
const enviados = new Set<string>()

/** Sólo para tests: olvida lo ya enviado en esta carga. */
export function resetErroresEnviados(): void {
  enviados.clear()
}

/** Clave local de deduplicación: no hace falta que coincida con la del servidor. */
function clave(mensaje: string, pila?: string | null): string {
  return `${mensaje}::${(pila ?? '').slice(0, 120)}`
}

export function reportarError(error: unknown, contexto?: string): void {
  if (typeof window === 'undefined') return

  try {
    const err = error instanceof Error ? error : new Error(String(error))
    const mensaje = contexto ? `${contexto}: ${err.message}` : err.message
    if (!mensaje || mensaje.trim().length === 0) return

    const k = clave(mensaje, err.stack)
    if (enviados.has(k)) return
    enviados.add(k)

    const cuerpo = JSON.stringify({
      message: mensaje,
      stack: err.stack ?? null,
      // SIN query: en esta app lleva latitud y longitud, y guardar la
      // ubicación de alguien junto a un error sería recoger un dato
      // personal por la puerta de atrás. El servidor lo recorta también,
      // pero lo correcto es no enviarlo.
      path: window.location.pathname,
    })

    // `fetch` con `credentials: 'omit'`, NO `sendBeacon`.
    //
    // El beacon manda SIEMPRE las cookies del origen y no hay forma de
    // desactivarlo. Esta ruta existe precisamente para ver también los
    // fallos de quien no ha consentido —el muro de cookies es lo primero
    // que se pinta, así que es donde más probable es que algo reviente—,
    // y recibir `wthr_anon` aquí convertiría telemetría anónima en
    // seguimiento. Que el servidor no lo lea no basta: la garantía tiene
    // que estar en lo que se envía.
    //
    // `keepalive` cubre el caso de que la página se cierre justo
    // después, que con un error en pantalla es bastante probable.
    void fetch(CLIENT_ERRORS_PATH, {
      method: 'POST',
      headers: { 'content-type': 'text/plain;charset=UTF-8' },
      body: cuerpo,
      credentials: 'omit',
      keepalive: true,
    }).catch(() => {})
  } catch {
    /* Si informar del error falla, no se añade una desgracia a la otra. */
  }
}
