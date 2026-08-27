'use client'

import { useSyncExternalStore } from 'react'
import { useEntitlements } from '@/lib/hooks/useEntitlements'
import { useFeatureEnabled } from '@/lib/hooks/useFeature'
import { STRINGS } from '@/lib/i18n'
import { useLocale } from '@/lib/LocaleContext'
import { CONSENT_COOKIE, isTrackingAllowed } from '@/lib/trackingConsent'

// Lee el consentimiento de anuncios desde el cookie (JS-writable).
function readConsentGranted(): boolean {
  if (typeof document === 'undefined') return false
  const m = document.cookie.match(new RegExp(`(?:^|; )${CONSENT_COOKIE}=([^;]*)`))
  return m ? isTrackingAllowed(decodeURIComponent(m[1])) : false
}

const emptySubscribe = () => () => {}

/**
 * B-NBT-10: advertising slot for free-tier visitors. Renders ONLY when
 * the visitor's plan allows ads (showAds), the admin has enabled the ads
 * feature flag, AND the visitor gave explicit consent (wthr_consent) —
 * auditoría F4: sin consentimiento los anuncios no se muestran, como
 * promete la política de cookies.
 */
export default function AdSlot({ placement = 'inline' }: { placement?: 'inline' | 'footer' }) {
  const ent = useEntitlements()
  const adsEnabled = useFeatureEnabled('feature.ads.adsense')
  const { locale } = useLocale()
  const consented = useSyncExternalStore(emptySubscribe, readConsentGranted, () => false)

  if (!ent?.showAds || !adsEnabled || !consented) return null

  return (
    <div
      role="complementary"
      aria-label={locale === 'en' ? 'Advertisement' : 'Publicidad'}
      className={`rounded-xl border border-dashed border-border/70 bg-surface-popover/40 flex items-center justify-center text-[10px] uppercase tracking-widest text-text-muted ${
        placement === 'footer' ? 'h-24' : 'h-20'
      }`}
    >
      {STRINGS[locale].adPlaceholder ?? 'Ad'}
    </div>
  )
}
