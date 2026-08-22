'use client'

import { useQuery } from '@tanstack/react-query'

interface FeatureFlag {
  enabled: boolean
  config: Record<string, unknown>
  description?: string
}

/** Client-side hook that reads a single feature flag through the public
 *  /api/features/[key] endpoint. Cached for 30s so a flurry of feature
 *  checks doesn't re-hit the DB. */
export function useFeature(key: string, options?: { enabled?: boolean }) {
  return useQuery<FeatureFlag>({
    queryKey: ['feature', key],
    queryFn: async () => {
      const r = await fetch(`/api/features/${encodeURIComponent(key)}`)
      if (!r.ok) return { enabled: false, config: {} }
      return r.json()
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    enabled: options?.enabled ?? true,
  })
}

/** Convenience helper for boolean checks. */
export function useFeatureEnabled(key: string): boolean {
  return useFeature(key).data?.enabled ?? false
}

/** Convenience helper for raw config (typed). */
export function useFeatureConfig<T = Record<string, unknown>>(key: string): T | undefined {
  return useFeature(key).data?.config as T | undefined
}
