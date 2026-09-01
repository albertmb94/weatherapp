/**
 * Forma de un plan y catálogo de prestaciones: SÓLO DATOS Y TIPOS.
 *
 * POR QUÉ ESTÁ SEPARADO DE `lib/plans.ts`. Ese módulo importa `./db`
 * y con él `@libsql/client`. El panel de admin es `'use client'` y
 * sólo necesitaba `PLAN_FEATURES` y el tipo `Plan`, pero el import
 * metía el cliente de base de datos entero —~482 KB— en un paquete de
 * navegador donde no puede ejecutarse.
 *
 * Regla para este fichero: nada con efectos de servidor.
 */

import type { Locale } from '@/lib/i18n'

export interface Plan {
  id: string
  kind: 'premium' | 'stations' | 'bundle'
  nameEs: string
  nameEn: string
  descriptionEs: string | null
  descriptionEn: string | null
  monthlyPriceCents: number | null
  yearlyPriceCents: number | null
  stripePriceIdMonthly: string | null
  stripePriceIdYearly: string | null
  stripeProductId: string | null
  features: string[]
  enabled: boolean
  sortOrder: number
  badgeEs: string | null
  badgeEn: string | null
  updatedAt: number | null
}

export const PLAN_FEATURES = [
  { key: 'unlimited_models', labelEs: 'Todos los modelos', labelEn: 'All models' },
  { key: '14_days', labelEs: 'Pronóstico a 14 días', labelEn: '14-day forecast' },
  { key: 'unlimited_cities', labelEs: 'Ciudades guardadas ilimitadas', labelEn: 'Unlimited saved cities' },
  { key: 'no_ads', labelEs: 'Sin anuncios', labelEn: 'No ads' },
  { key: 'csv_export', labelEs: 'Exportación CSV histórica', labelEn: 'Historical CSV export' },
  { key: 'push_alerts', labelEs: 'Alertas push', labelEn: 'Push alerts' },
  { key: 'stations_tab', labelEs: 'Tab Estaciones', labelEn: 'Stations tab' },
  { key: 'full_history', labelEs: 'Histórico completo de estaciones', labelEn: 'Full station history' },
  { key: 'priority_support', labelEs: 'Soporte prioritario', labelEn: 'Priority support' },
  { key: 'api_access', labelEs: 'Acceso API', labelEn: 'API access' },
] as const

export type PlanFeatureKey = (typeof PLAN_FEATURES)[number]['key']

/**
 * Textos de un plan en el idioma pedido.
 *
 * POR QUÉ HACE FALTA. Las filas ya guardan las dos versiones
 * (`nameEs`/`nameEn`, `descriptionEs`/`descriptionEn`,
 * `badgeEs`/`badgeEn`) y `PLAN_FEATURES` ya tiene `labelEs`/`labelEn`,
 * pero las páginas leían SIEMPRE la española. La traducción existía y
 * no se usaba: Google indexaba /en/premium con el título en inglés y el
 * cuerpo en español, y quien llegaba en inglés se encontraba la página
 * de pago sin entenderla.
 */
export function planCopy(
  plan: Plan,
  locale: Locale,
): { name: string; description: string | null; badge: string | null } {
  const es = locale === 'es'
  return {
    name: es ? plan.nameEs : plan.nameEn,
    description: es ? plan.descriptionEs : plan.descriptionEn,
    badge: es ? plan.badgeEs : plan.badgeEn,
  }
}

/** Etiqueta de una prestación del catálogo, en el idioma pedido. */
export function planFeatureLabel(key: string, locale: Locale): string | null {
  const f = PLAN_FEATURES.find(x => x.key === key)
  if (!f) return null
  return locale === 'es' ? f.labelEs : f.labelEn
}

/**
 * Precio formateado en la convención del idioma.
 *
 * Los importes se guardan en céntimos de euro. La MONEDA no cambia
 * —cobramos en euros a todo el mundo—, sólo cómo se escribe:
 * `12,00 €` en español, `€12.00` en inglés. Antes se hacía
 * `(cents / 100).toFixed(2) + ' €'` a pelo, que en inglés se lee raro.
 */
export function formatearPrecio(cents: number, locale: Locale): string {
  return new Intl.NumberFormat(locale === 'es' ? 'es-ES' : 'en-IE', {
    style: 'currency',
    currency: 'EUR',
  }).format(cents / 100)
}

/** Sufijo del periodo de facturación. */
export const PERIODO: Record<Locale, { mes: string; ano: string }> = {
  es: { mes: '/ mes', ano: '/ año' },
  en: { mes: '/ mo', ano: '/ yr' },
}

