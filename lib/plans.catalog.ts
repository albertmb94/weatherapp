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
