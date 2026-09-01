/**
 * Forma de los permisos y valores por defecto: SÓLO DATOS Y TIPOS.
 *
 * POR QUÉ ESTÁ SEPARADO DE `lib/entitlements.ts`. Ese módulo importa
 * `./db` (y `crypto`). `lib/hooks/useEntitlements.ts` es un hook de
 * cliente y sólo necesitaba el tipo `Entitlements` y la constante
 * `FREE_ENTITLEMENTS`, pero importar la constante —un valor, no un
 * tipo— arrastraba el módulo entero y con él `@libsql/client` al
 * paquete del navegador: ~482 KB de cliente de base de datos que allí
 * no puede ni conectarse, porque `TURSO_DATABASE_URL` no lleva
 * prefijo `NEXT_PUBLIC_`.
 *
 * Ojo con esto al editar: basta con que un hook de cliente importe UN
 * valor de un módulo de servidor para volver a meterlo entero. Los
 * tipos se borran al compilar; los valores no.
 *
 * Regla para este fichero: nada con efectos de servidor.
 */

export interface Entitlements {
  premium: boolean
  stations: boolean
  /** Derived convenience flags. */
  hasAny: boolean
  // Feature flags derived from entitlements
  maxModels: number
  maxDays: number
  maxSavedCities: number
  maxAffiliateSectionsPerDay: number
  showAds: boolean
  pushAlerts: boolean
  exportHistorical: boolean
  canViewStationsTab: boolean
}

export function featuresFor(p: { premium: boolean; stations: boolean }): Entitlements {
  // B-NBT-14 (2026-08-22): TODOS los usuarios ven TODO — sin restricciones.
  // El owner pidió explícitamente que nadie tenga limitaciones mientras
  // la monetización no esté activa. Cuando se quiera reintroducir el
  // paywall, restaurar las matrices por plan (ver git history).
  void p
  return {
    premium: true,
    stations: true,
    hasAny: true,
    maxModels: 999,
    maxDays: 14,
    maxSavedCities: 999,
    maxAffiliateSectionsPerDay: 3,
    showAds: false,
    pushAlerts: true,
    exportHistorical: true,
    canViewStationsTab: true,
  }
}

export const FREE_ENTITLEMENTS = featuresFor({ premium: false, stations: false })
