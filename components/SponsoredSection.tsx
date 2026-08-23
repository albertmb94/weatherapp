'use client'

import { useEffect, useState } from 'react'
import { useLocale } from '@/lib/LocaleContext'
import { evaluateTriggers, type TriggerMatch } from '@/lib/sponsored'
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
  uv_high: { es: 'ProtecciÃ³n solar recomendada', en: 'Sun protection recommended' },
  rain_24h: { es: 'Para la lluvia', en: 'For the rain' },
  heat: { es: 'Para el calor', en: 'For the heat' },
  wind_strong: { es: 'Para el viento', en: 'For the wind' },
  frost: { es: 'Para las heladas', en: 'For the frost' },
  snow: { es: 'Para la nieve', en: 'For the snow' },
}

interface SponsoredSectionProps {
  snapshot: CurrentSnapshot | null
  enabled: boolean
}

/**
 * B-NBT-13 (2026-08-22): sponsored product card contextual al forecast.
 *
 * Aparece SOLO cuando las condiciones actuales disparan un trigger del
 * catÃ¡logo de afiliados (UV alto, lluvia esperada, etc.) y el usuario
 * no ha superado su lÃ­mite diario. Enlaza a /api/affiliate/redirect
 * para registrar el click antes de redirigir a Amazon.
 */
export default function SponsoredSection({ snapshot, enabled }: SponsoredSectionProps) {
  const { locale } = useLocale()
  const [product, setProduct] = useState<SponsoredProduct | null>(null)
  const [matchedTrigger, setMatchedTrigger] = useState<TriggerMatch | null>(null)

  const matches = evaluateTriggers(snapshot)
  const best = matches[0] ?? null

  useEffect(() => {
    if (!enabled || !best || !snapshot) {
      setProduct(null)
      setMatchedTrigger(null)
      return
    }
    const controller = new AbortController()
    fetch(
      `/api/affiliates/serve?trigger=${best.key}&locale=${locale}`,
      { signal: controller.signal },
    )
      .then(r => r.json())
      .then(data => {
        if (data.product) {
          setProduct(data.product)
          setMatchedTrigger(best)
        } else {
          setProduct(null)
          setMatchedTrigger(null)
        }
      })
      .catch(() => {})
    return () => controller.abort()
  }, [best?.key, locale, enabled, snapshot])

  if (!product || !matchedTrigger) return null

  const triggerLabel = TRIGGER_LABELS[matchedTrigger.key]?.[locale] ?? ''

  return (
    <section aria-label={triggerLabel} className="rounded-2xl border border-amber-500/30 bg-gradient-to-br from-amber-500/5 to-transparent p-4">
      <div className="flex items-start gap-3">
        {product.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={product.imageUrl} alt="" className="w-16 h-16 rounded-lg object-cover shrink-0" />
        ) : (
          <div className="w-10 h-10 rounded-lg bg-amber-500/15 flex items-center justify-center shrink-0 text-xl">ðŸ›’</div>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-[10px] uppercase tracking-widest text-text-muted">{triggerLabel}</p>
          <p className="text-sm font-medium text-text-primary mt-0.5">{product.title}</p>
          {product.description ? (
            <p className="text-xs text-text-secondary mt-0.5 line-clamp-2">{product.description}</p>
          ) : null}
          {product.priceLabel ? (
            <span className="inline-block text-xs font-semibold text-accent mt-1">{product.priceLabel}</span>
          ) : null}
        </div>
        <a
          href={`/api/affiliate/redirect?program=amazon&product_id=${encodeURIComponent(product.id)}&trigger=${matchedTrigger.key}&to=${encodeURIComponent(product.affiliateUrl)}`}
          target="_blank"
          rel="noopener noreferrer sponsored"
          className="shrink-0 px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-medium self-center"
        >
          {locale === 'es' ? 'Ver' : 'View'}
        </a>
      </div>
      <p className="text-[9px] text-text-muted mt-2 text-right">
        {locale === 'en' ? 'Affiliate link â€” supports this project at no cost to you.' : 'Enlace de afiliado â€” apoya este proyecto sin coste adicional.'}
      </p>
    </section>
  )
}
