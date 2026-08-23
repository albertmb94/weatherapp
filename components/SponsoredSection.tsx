'use client'

import { useEffect, useState } from 'react'
import { useLocale } from '@/lib/LocaleContext'
import { evaluateTriggers } from '@/lib/sponsored'
import type { CurrentSnapshot } from '@/lib/friendlyForecast'

interface SponsoredProduct {
  id: string
  title: string
  description?: string | null
  priceLabel?: string | null
  imageUrl?: string | null
  affiliateUrl: string
}

const TRIGGER_LABELS: Record<string, { es: string; en: string }> = {
  uv_high: { es: 'Protección solar', en: 'Sun protection' },
  rain_24h: { es: 'Para la lluvia', en: 'For the rain' },
  heat: { es: 'Para el calor', en: 'For the heat' },
  wind_strong: { es: 'Para el viento', en: 'For the wind' },
  frost: { es: 'Para las heladas', en: 'For the frost' },
  snow: { es: 'Para la nieve', en: 'For the snow' },
}

interface SponsoredSectionProps {
  snapshot: CurrentSnapshot | null
}

export default function SponsoredSection({ snapshot }: SponsoredSectionProps) {
  const { locale } = useLocale()
  const [product, setProduct] = useState<SponsoredProduct | null>(null)
  const [triggerKey, setTriggerKey] = useState<string | null>(null)

  const matches = evaluateTriggers(snapshot)
  const best = matches[0] ?? null

  useEffect(() => {
    if (!best || !snapshot) { setProduct(null); setTriggerKey(null); return }
    const controller = new AbortController()
    fetch(`/api/affiliates/serve?trigger=${best.key}&locale=${locale}`, { signal: controller.signal })
      .then(r => r.json())
      .then(data => {
        if (data.product) { setProduct(data.product); setTriggerKey(best.key) }
        else { setProduct(null); setTriggerKey(null) }
      })
      .catch(() => {})
    return () => controller.abort()
  }, [best?.key, locale, snapshot])

  if (!product || !triggerKey) return null

  const label = TRIGGER_LABELS[triggerKey]?.[locale] ?? ''

  return (
    <a
      href={`/api/affiliate/redirect?program=amazon&product_id=${encodeURIComponent(product.id)}&trigger=${triggerKey}&to=${encodeURIComponent(product.affiliateUrl)}`}
      target="_blank"
      rel="noopener noreferrer sponsored"
      className="flex items-center gap-3 rounded-xl border border-amber-400/25 bg-amber-500/[0.04] px-4 py-2.5 hover:border-amber-400/50 hover:bg-amber-500/[0.08] transition-colors group"
      aria-label={label}
    >
      {product.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={product.imageUrl} alt="" className="w-10 h-10 rounded-lg object-cover shrink-0" />
      ) : (
        <span className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0 text-sm" aria-hidden="true">
          🛍️
        </span>
      )}
      <div className="min-w-0 flex-1 leading-tight">
        <p className="text-[9px] uppercase tracking-widest text-text-muted">{label}</p>
        <p className="text-xs font-medium text-text-primary truncate">{product.title}</p>
        <p className="text-[10px] text-text-muted truncate">
          {[product.description, product.priceLabel].filter(Boolean).join(' · ') || (locale === 'es' ? 'Ver en Amazon' : 'View on Amazon')}
        </p>
      </div>
      <span className="shrink-0 px-2 py-1 rounded-md text-[10px] font-medium text-accent opacity-60 group-hover:opacity-100 transition-opacity" aria-hidden="true">
        →
      </span>
    </a>
  )
}
