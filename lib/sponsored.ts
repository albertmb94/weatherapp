/**
 * B-NBT-15 (2026-08-22): los 3 slots patrocinados.
 *
 * Lógica por hora local de la ubicación consultada:
 *
 *   18:00–04:00 → slot_sunset (siempre, sin condición meteorológica)
 *   04:00–18:00 → lluvia ≥ 1 mm → slot_rain
 *                 resto        → slot_uv
 */
export type SponsoredSlotKey = 'slot_uv' | 'slot_rain' | 'slot_sunset'

/**
 * Devuelve el slot activo según la hora local y la precipitación del día.
 *
 * @param localHour  Hora local (0–23) en la ubicación consultada.
 * @param precipTodayMm  Precipitación total esperada HOY (mm).
 */
export function pickActiveSlot(localHour: number, precipTodayMm: number): SponsoredSlotKey {
  if (localHour >= 18 || localHour < 4) return 'slot_sunset'
  if (precipTodayMm >= 1) return 'slot_rain'
  return 'slot_uv'
}
