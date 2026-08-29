/**
 * Formato de celda geográfica, en un solo sitio.
 *
 * La ingesta guarda `lat.toFixed(2),lon.toFixed(2)` (~1 km). Ese formato
 * lo validan ya dos rutas de administración y lo va a usar una tercera;
 * tenerlo duplicado es cómo acaban divergiendo (una acepta lo que la otra
 * rechaza) sin que nadie se entere.
 */

const FORMATO = /^-?\d{1,2}\.\d{2},-?\d{1,3}\.\d{2}$/

/**
 * Devuelve la celda si es válida, o null.
 *
 * Se comprueba el formato Y el rango: `-?\d{1,2}` deja pasar latitudes de
 * hasta 99, que no existen. Es la validación que evita que un parámetro
 * de una ruta de admin sea otra cosa que una celda real.
 */
export function celdaValida(raw: string | null | undefined): string | null {
  if (!raw || !FORMATO.test(raw)) return null
  const [lat, lon] = raw.split(',').map(Number)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null
  return raw
}

/** Las coordenadas de una celda ya validada. */
export function coordenadasDe(celda: string): { lat: number; lon: number } | null {
  if (!celdaValida(celda)) return null
  const [lat, lon] = celda.split(',').map(Number)
  return { lat, lon }
}
