/**
 * Plans — subscription plans stored in the DB so the admin can edit
 * prices, descriptions, Stripe Price IDs and feature lists without a
 * redeploy. The first three plans (Premium, Stations, Bundle) are
 * seeded by `seedDefaultPlans()` on first request.
 */

import { db } from './db'

let schemaReady: Promise<boolean> | null = null

async function ensureSchema(): Promise<boolean> {
  if (schemaReady) return schemaReady
  schemaReady = db.ensure().then(async ok => {
    if (!ok) return false
    try {
      await db.execute(
        `CREATE TABLE IF NOT EXISTS plans (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL,
          name_es TEXT NOT NULL,
          name_en TEXT NOT NULL,
          description_es TEXT,
          description_en TEXT,
          monthly_price_cents INTEGER,
          yearly_price_cents INTEGER,
          stripe_price_id_monthly TEXT,
          stripe_price_id_yearly TEXT,
          features TEXT,
          enabled INTEGER NOT NULL DEFAULT 1,
          sort_order INTEGER NOT NULL DEFAULT 0,
          badge_es TEXT,
          badge_en TEXT,
          updated_at INTEGER
        )`,
      )
      return true
    } catch {
      return false
    }
  }).catch(() => false)
  return schemaReady
}

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
  features: string[]
  enabled: boolean
  sortOrder: number
  badgeEs: string | null
  badgeEn: string | null
  updatedAt: number | null
}

interface PlanRow {
  id: string
  kind: string
  name_es: string
  name_en: string
  description_es: string | null
  description_en: string | null
  monthly_price_cents: number | null
  yearly_price_cents: number | null
  stripe_price_id_monthly: string | null
  stripe_price_id_yearly: string | null
  features: string | null
  enabled: number | string
  sort_order: number | string
  badge_es: string | null
  badge_en: string | null
  updated_at: number | null
}

function rowToPlan(r: PlanRow): Plan {
  return {
    id: r.id,
    kind: (r.kind as Plan['kind']) ?? 'premium',
    nameEs: r.name_es,
    nameEn: r.name_en,
    descriptionEs: r.description_es,
    descriptionEn: r.description_en,
    monthlyPriceCents: r.monthly_price_cents != null ? Number(r.monthly_price_cents) : null,
    yearlyPriceCents: r.yearly_price_cents != null ? Number(r.yearly_price_cents) : null,
    stripePriceIdMonthly: r.stripe_price_id_monthly,
    stripePriceIdYearly: r.stripe_price_id_yearly,
    features: r.features ? JSON.parse(r.features) : [],
    enabled: Number(r.enabled) === 1,
    sortOrder: Number(r.sort_order ?? 0),
    badgeEs: r.badge_es,
    badgeEn: r.badge_en,
    updatedAt: r.updated_at != null ? Number(r.updated_at) : null,
  }
}

export async function listPlans(onlyEnabled = false): Promise<Plan[]> {
  await ensureSchema()
  try {
    const sql = onlyEnabled
      ? 'SELECT * FROM plans WHERE enabled = 1 ORDER BY sort_order ASC, id ASC'
      : 'SELECT * FROM plans ORDER BY sort_order ASC, id ASC'
    const rows = await db.select<PlanRow>(sql)
    return rows.map(rowToPlan)
  } catch {
    return []
  }
}

export async function getPlan(id: string): Promise<Plan | null> {
  await ensureSchema()
  try {
    const rows = await db.select<PlanRow>('SELECT * FROM plans WHERE id = ?', [id])
    return rows[0] ? rowToPlan(rows[0]) : null
  } catch {
    return null
  }
}

export interface UpsertPlanInput {
  id: string
  kind: Plan['kind']
  nameEs: string
  nameEn: string
  descriptionEs?: string | null
  descriptionEn?: string | null
  monthlyPriceCents?: number | null
  yearlyPriceCents?: number | null
  stripePriceIdMonthly?: string | null
  stripePriceIdYearly?: string | null
  features: string[]
  enabled?: boolean
  sortOrder?: number
  badgeEs?: string | null
  badgeEn?: string | null
}

export async function upsertPlan(input: UpsertPlanInput): Promise<boolean> {
  await ensureSchema()
  try {
    await db.execute(
      `INSERT INTO plans (id, kind, name_es, name_en, description_es, description_en, monthly_price_cents, yearly_price_cents, stripe_price_id_monthly, stripe_price_id_yearly, features, enabled, sort_order, badge_es, badge_en, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         kind = excluded.kind,
         name_es = excluded.name_es,
         name_en = excluded.name_en,
         description_es = excluded.description_es,
         description_en = excluded.description_en,
         monthly_price_cents = excluded.monthly_price_cents,
         yearly_price_cents = excluded.yearly_price_cents,
         stripe_price_id_monthly = excluded.stripe_price_id_monthly,
         stripe_price_id_yearly = excluded.stripe_price_id_yearly,
         features = excluded.features,
         enabled = excluded.enabled,
         sort_order = excluded.sort_order,
         badge_es = excluded.badge_es,
         badge_en = excluded.badge_en,
         updated_at = excluded.updated_at`,
      [
        input.id,
        input.kind,
        input.nameEs,
        input.nameEn,
        input.descriptionEs ?? null,
        input.descriptionEn ?? null,
        input.monthlyPriceCents ?? null,
        input.yearlyPriceCents ?? null,
        input.stripePriceIdMonthly ?? null,
        input.stripePriceIdYearly ?? null,
        JSON.stringify(input.features ?? []),
        input.enabled === false ? 0 : 1,
        input.sortOrder ?? 0,
        input.badgeEs ?? null,
        input.badgeEn ?? null,
        Date.now(),
      ],
    )
    return true
  } catch (err) {
    console.warn('[plans] upsert failed', err)
    return false
  }
}

export async function seedDefaultPlans(): Promise<void> {
  await ensureSchema()
  const defaults: UpsertPlanInput[] = [
    {
      id: 'premium',
      kind: 'premium',
      nameEs: 'Premium',
      nameEn: 'Premium',
      descriptionEs: 'Acceso completo: todos los modelos, 14 días, ciudades ilimitadas, sin anuncios, exportación CSV histórica, alertas push.',
      descriptionEn: 'Full access: all models, 14 days, unlimited cities, no ads, historical CSV export, push alerts.',
      monthlyPriceCents: 500,
      yearlyPriceCents: 4000,
      features: ['unlimited_models', '14_days', 'unlimited_cities', 'no_ads', 'csv_export', 'push_alerts'],
      enabled: false,
      sortOrder: 2,
    },
    {
      id: 'stations',
      kind: 'stations',
      nameEs: 'Estaciones',
      nameEn: 'Stations',
      descriptionEs: 'Cruza el ensemble con observaciones reales de AEMET, Meteocat y Meteoclimatic. Compatible con Premium.',
      descriptionEn: 'Cross-reference the ensemble with real AEMET, Meteocat and Meteoclimatic observations. Compatible with Premium.',
      monthlyPriceCents: 200,
      yearlyPriceCents: 2000,
      features: ['stations_tab', 'full_history'],
      enabled: false,
      sortOrder: 3,
    },
    {
      id: 'bundle',
      kind: 'bundle',
      nameEs: 'Premium + Estaciones',
      nameEn: 'Premium + Stations',
      descriptionEs: 'El pack completo. Ahorra 1 €/mes frente a las dos suscripciones por separado.',
      descriptionEn: 'The full pack. Save €1/mo compared to buying both subscriptions separately.',
      monthlyPriceCents: 700,
      yearlyPriceCents: 6000,
      features: ['unlimited_models', '14_days', 'unlimited_cities', 'no_ads', 'csv_export', 'push_alerts', 'stations_tab', 'full_history'],
      enabled: false,
      sortOrder: 1,
      badgeEs: 'AHORRA 33%',
      badgeEn: 'SAVE 33%',
    },
  ]
  for (const p of defaults) {
    try {
      await db.execute(
        `INSERT OR IGNORE INTO plans (id, kind, name_es, name_en, description_es, description_en, monthly_price_cents, yearly_price_cents, features, enabled, sort_order, badge_es, badge_en, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          p.id,
          p.kind,
          p.nameEs,
          p.nameEn,
          p.descriptionEs ?? null,
          p.descriptionEn ?? null,
          p.monthlyPriceCents ?? null,
          p.yearlyPriceCents ?? null,
          JSON.stringify(p.features),
          p.enabled ? 1 : 0,
          p.sortOrder ?? 0,
          p.badgeEs ?? null,
          p.badgeEn ?? null,
          Date.now(),
        ],
      )
    } catch {
      /* ignore */
    }
  }
}

/** Catalogue of feature keys the admin can attach to a plan. Keep this
 *  in sync with the FeatureGate component in the home page. */
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
