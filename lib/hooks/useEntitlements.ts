'use client'

import { useQuery } from '@tanstack/react-query'
import type { Entitlements } from '@/lib/entitlements'
import { FREE_ENTITLEMENTS } from '@/lib/entitlements'

/**
 * B-NBT-10: resolve the visitor's plan limits client-side.
 *
 * - While loading (or on error) we return `undefined` so callers can
 *   decide their own fallback — most UI wants NO CAP until proven,
 *   otherwise premium users would see a free-tier flash on every load.
 * - Once loaded, callers MUST clamp through these values (maxModels /
 *   maxDays / maxSavedCities / exportHistorical / showAds).
 */

interface EntitlementsResponse {
  premium: boolean
  stations: boolean
  entitlements: Entitlements
}

export function useEntitlements(): Entitlements | undefined {
  const { data } = useQuery<EntitlementsResponse>({
    queryKey: ['entitlements'],
    queryFn: async ({ signal }) => {
      const res = await fetch('/api/entitlements', { signal })
      if (!res.ok) throw new Error('entitlements_unavailable')
      return res.json() as Promise<EntitlementsResponse>
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: true,
  })
  return data?.entitlements
}

/** Convenience: caps with a generous default so premium users never see
 *  a restricted state before hydration completes. */
export const UNCAPPED: Entitlements = {
  ...FREE_ENTITLEMENTS,
  premium: true,
  hasAny: true,
  maxModels: 999,
  maxDays: 14,
  maxSavedCities: 999,
  showAds: false,
  exportHistorical: true,
}
