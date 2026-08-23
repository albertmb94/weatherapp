/**
 * B-NBT-15 (2026-08-22): evaluación de los 3 slots patrocinados.
 *
 * Un solo anuncio simultáneo. Se evalúan las condiciones en orden de
 * prioridad y se devuelve el PRIMER slot que cumpla. Si ninguno cumple,
 * devuelve null.
 *
 *   - slot_uv: el pico de UV del día alcanzó ≥ 4.
 *   - slot_rain: se espera ≥ 1 mm de precipitación hoy.
 *   - slot_sunset: faltan ≤ 2 horas para la puesta de sol.
 */
export type SponsoredSlotKey = 'slot_uv' | 'slot_rain' | 'slot_sunset'

export interface SlotConditions {
  /** Pico diario de índice UV (del ensemble). */
  uvPeak: number
  /** Precipitación total esperada HOY (mm). */
  maxPrecipMm: number
  /** Ahora mismo (ms epoch). */
  nowMs: number
  /** Timestamp de la puesta de sol de HOY (ms), o null. */
  sunsetMs: number | null
}

const SUNSET_WINDOW_MS = 2 * 60 * 60 * 1000

export function pickActiveSlot(c: SlotConditions): SponsoredSlotKey | null {
  if (c.uvPeak >= 4) return 'slot_uv'
  if (c.maxPrecipMm >= 1) return 'slot_rain'
  if (c.sunsetMs !== null && c.sunsetMs > c.nowMs && c.sunsetMs - c.nowMs <= SUNSET_WINDOW_MS) return 'slot_sunset'
  return null
}
