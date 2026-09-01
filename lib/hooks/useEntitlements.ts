'use client'

import { useQuery } from '@tanstack/react-query'
import type { Entitlements } from '@/lib/entitlements.catalog'
import { FREE_ENTITLEMENTS } from '@/lib/entitlements.catalog'

/**
 * B-NBT-11: resolve the visitor's plan limits client-side.
 *
 * B-NBT-12 FIX (fail-closed): mientras carga o si el endpoint falla,
 * devuelve FREE_ENTITLEMENTS — nunca UNCAPPED. Así los usuarios free
 * ven SIEMPRE las limitaciones de su plan por defecto (7 días,
 * 7 modelos, 1 ciudad), y premium se desbloquea en cuanto la cookie
 * de entitlement resuelve. Es la semántica que el owner pidió
 * explícitamente: "por defecto limitado".
 */

interface EntitlementsResponse {
  premium: boolean
  stations: boolean
  entitlements: Entitlements
}

export function useEntitlements(): Entitlements {
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
    // Si el endpoint falla, mantener el último valor válido (o free).
    retry: 1,
  })
  return data?.entitlements ?? FREE_ENTITLEMENTS
}
