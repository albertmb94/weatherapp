'use client'

import type { ReactNode } from 'react'
import type { Entitlements } from '@/lib/entitlements'

type EntitlementFlag = 'exportHistorical' | 'pushAlerts' | 'canViewStationsTab' | 'premium' | 'stations'

interface FeatureGateProps {
  /** Boolean entitlement flag to test. */
  flag: EntitlementFlag
  entitlements: Entitlements | undefined
  /** Rendered when the flag is false / entitlements not loaded yet. */
  fallback?: ReactNode
  children: ReactNode
}

/** B-NBT-10: declarative gate over the visitor's plan. While
 *  entitlements are loading we show the FALLBACK (fail-closed) so a
 *  premium perk never flashes for free users; callers that prefer
 *  fail-open can pass `entitlements ?? UNCAPPED`. */
export default function FeatureGate({ flag, entitlements, fallback = null, children }: FeatureGateProps) {
  const allowed = entitlements?.[flag] === true
  return <>{allowed ? children : fallback}</>
}
