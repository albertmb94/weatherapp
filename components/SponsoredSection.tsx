'use client'

import { useEffect, useState } from 'react'
import { useLocale } from '@/lib/LocaleContext'
import type { SponsoredSlotKey } from '@/lib/sponsored'

interface SponsoredProduct {
  id: string
  title: string
  description?: string | null
  affiliateUrl: string
}

const SLOT_LABELS: Record<SponsoredSlotKey, { es: string; en: string }> = {
  slot_uv: { es: 'Protección solar', en: 'Sun protection' },
  slot_rain: { es: 'Para la lluvia', en: 'For the rain' },
  slot_sunset: { es: 'Para el atardecer', en: 'For the evening' },
}

interface SponsoredSectionProps {
  /** Slot activo (null = no mostrar nada). */
  slotKey: SponsoredSlotKey | null
}

export default function SponsoredSection({ slotKey }: SponsoredSectionProps) {
  const { locale } = useLocale()
  const [product, setProduct] = useState<SponsoredProduct | null>(null)

  // TAMPOCO se gatea por consentimiento, y la asimetría con AdSlot es
  // correcta, no una incoherencia:
  //
  //   - AdSlot carga AdSense, que ESCRIBE cookies en el dispositivo y
  //     personaliza publicidad. Eso sí requiere permiso previo.
  //   - Esto es un enlace de texto a Amazon. Mostrarlo no almacena ni
  //     lee nada en el dispositivo, que es lo que la ePrivacy somete a
  //     consentimiento.
  //
  // Y la atribución del clic YA respeta el consentimiento donde toca:
  // /api/affiliate/redirect registra `anon_id = 'consent_denied'` en vez
  // del identificador cuando no hay permiso, y aun así redirige.
  //
  // Gatearlo aquí escondía la monetización a TODO visitante que aún no
  // hubiera respondido al banner — es decir, a todos en su primera
  // visita — sin ganar nada a cambio.

  // Reset cuando desaparece el slot: ajuste de estado en fase de render
  // (patrón oficial de React), evita el setState síncrono en el efecto.
  if (!slotKey && product !== null) {
    setProduct(null)
  }

  useEffect(() => {
    if (!slotKey) return
    const controller = new AbortController()
    fetch(`/api/affiliates/serve?trigger=${slotKey}&locale=${locale}`, { signal: controller.signal })
      .then(r => r.json())
      .then(data => setProduct(data.product ?? null))
      .catch(() => setProduct(null))
    return () => controller.abort()
  }, [slotKey, locale])

  if (!product || !slotKey) return null

  const label = SLOT_LABELS[slotKey]?.[locale] ?? ''

  return (
    <a
      href={`/api/affiliate/redirect?program=amazon&product_id=${encodeURIComponent(product.id)}&trigger=${slotKey}&to=${encodeURIComponent(product.affiliateUrl)}`}
      target="_blank"
      rel="noopener noreferrer sponsored"
      className="flex items-center gap-3 rounded-xl border border-amber-400/25 bg-amber-500/[0.04] px-4 py-2.5 hover:border-amber-400/50 hover:bg-amber-500/[0.08] transition-colors group"
      aria-label={label}
    >
      <div className="min-w-0 flex-1 leading-tight">
        <p className="text-[9px] uppercase tracking-widest text-text-muted">{label}</p>
        <p className="text-xs font-medium text-text-primary truncate">{product.title}</p>
        <p className="text-[10px] text-text-muted truncate">
          {product.description || (locale === 'es' ? 'Ver en Amazon' : 'View on Amazon')}
        </p>
      </div>
      <span className="shrink-0 px-2 py-1 rounded-md text-[10px] font-medium text-accent opacity-60 group-hover:opacity-100 transition-opacity" aria-hidden="true">
        →
      </span>
    </a>
  )
}
