'use client'

import { useEntitlements } from '@/lib/hooks/useEntitlements'
import { useFeatureEnabled } from '@/lib/hooks/useFeature'
import { STRINGS } from '@/lib/i18n'
import { useLocale } from '@/lib/LocaleContext'

/**
 * B-NBT-10: advertising slot for free-tier visitors. Renders ONLY when
 * the visitor's plan allows ads (showAds) AND the admin has enabled the
 * ads feature flag. Premium users (showAds=false) never see it; while
 * entitlements load it stays hidden (fail-closed).
 *
 * The actual ad network script is NOT injected yet — this is the
 * reserved inventory so layout doesn't jump when AdSense gets wired.
 */
export default function AdSlot({ placement = 'inline' }: { placement?: 'inline' | 'footer' }) {
  const ent = useEntitlements()
  const adsEnabled = useFeatureEnabled('feature.ads.adsense')
  const { locale } = useLocale()

  if (!ent?.showAds || !adsEnabled) return null

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
