'use client'

import { useState, useEffect } from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { extractAsinFromAmazonUrl } from '@/lib/affiliate'

interface SlotProduct {
  id: string
  trigger: string
  asin: string
  locale: string
  title: string
  description?: string | null
  affiliateUrl: string
  enabled: boolean
}

const SLOTS = [
  { key: 'slot_uv', icon: '☀️', labelEs: 'UV (pico ≥ 4)', hint: 'Se muestra cuando el índice UV del día alcanza 4 o más.' },
  { key: 'slot_rain', icon: '🌧️', labelEs: 'Lluvia (≥ 1 mm)', hint: 'Se muestra cuando se espera 1 mm o más de precipitación hoy.' },
  { key: 'slot_sunset', icon: '🌅', labelEs: 'Atardecer (próximas 2 h)', hint: 'Se muestra cuando falta menos de 2 horas para la puesta de sol.' },
] as const

function extractAsin(url: string): string | null {
  const m = /(?:\/dp\/|\/gp\/product\/)([A-Z0-9]{10})/i.exec(url)
  return m ? m[1].toUpperCase() : null
}

export default function AffiliatesAdminPage() {
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'affiliate-products'],
    queryFn: async () => {
      const r = await fetch('/api/admin/affiliates')
      if (!r.ok) return { ok: false, products: [] }
      return r.json() as Promise<{ ok: boolean; products: SlotProduct[] }>
    },
  })

  const products = data?.products ?? []
  const byTrigger = new Map<string, SlotProduct>()
  for (const p of products) byTrigger.set(p.trigger, p)

  const saveSlot = useMutation({
    mutationFn: async ({ trigger, title, description, amazonUrl }: {
      trigger: string; title: string; description: string; amazonUrl: string
    }) => {
      const r = await fetch('/api/admin/affiliates', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ trigger, amazonUrl, title, description, enabled: true }),
      })
      if (!r.ok) throw new Error('save_failed')
      return r.json()
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'affiliate-products'] }),
  })

  return (
    <div className="p-6 space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Afiliados</h1>
        <p className="text-sm text-text-tertiary">
          Configura un producto Amazon por slot. Solo se muestra UN anuncio a la vez:
          el primero cuyo trigger coincida con las condiciones actuales.
          Pega la URL completa de Amazon y el ASIN se extrae automáticamente.
        </p>
      </header>

      {isLoading && <div className="text-sm text-text-tertiary">Cargando…</div>}

      <div className="space-y-4">
        {SLOTS.map(slot => (
          <SlotEditor
            key={slot.key}
            slot={slot}
            existing={byTrigger.get(slot.key) ?? null}
            onSave={(title, description, amazonUrl) =>
              saveSlot.mutateAsync({ trigger: slot.key, title, description, amazonUrl })}
            saving={saveSlot.isPending}
          />
        ))}
      </div>
    </div>
  )
}

interface SlotDef {
  key: string
  icon: string
  labelEs: string
  hint: string
}

function SlotEditor({ slot, existing, onSave, saving }: {
  slot: SlotDef
  existing: SlotProduct | null
  onSave: (title: string, description: string, amazonUrl: string) => Promise<unknown>
  saving: boolean
}) {
  const [amazonUrl, setAmazonUrl] = useState(existing?.affiliateUrl ?? '')
  const [title, setTitle] = useState(existing?.title ?? '')
  const [description, setDescription] = useState((existing as SlotProduct & { description?: string })?.description ?? '')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setAmazonUrl(existing?.affiliateUrl ?? '')
    setTitle(existing?.title ?? '')
    setDescription((existing as SlotProduct & { description?: string })?.description ?? '')
  }, [existing])

  const asin = extractAsin(amazonUrl)
  const canSave = amazonUrl.trim().length > 0 && title.trim().length > 0 && !!asin

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSave) return
    await onSave(title.trim(), description.trim(), amazonUrl.trim())
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-2xl border border-border bg-surface-raised p-4 space-y-3"
    >
      <div className="flex items-center gap-2">
        <span className="text-lg" aria-hidden>{slot.icon}</span>
        <h3 className="text-sm font-semibold">{slot.labelEs}</h3>
        {existing && <span className="text-[10px] text-emerald-400 ml-auto">✓ configurado</span>}
      </div>
      <p className="text-[11px] text-text-muted">{slot.hint}</p>
      <div className="space-y-2">
        <label className="block">
          <span className="text-[10px] text-text-tertiary block mb-0.5">URL del producto en Amazon</span>
          <input
            type="url"
            value={amazonUrl}
            onChange={e => setAmazonUrl(e.target.value)}
            required
            placeholder="https://www.amazon.es/…/dp/B0XXXXXXXX"
            className="w-full px-2 py-1.5 rounded border border-border bg-surface text-xs font-mono"
          />
          {asin && <span className="text-[10px] text-emerald-400 block mt-0.5">ASIN: {asin}</span>}
        </label>
        <label className="block">
          <span className="text-[10px] text-text-tertiary block mb-0.5">Título visible</span>
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            required
            placeholder="Ej: Estación meteorológica digital"
            className="w-full px-2 py-1.5 rounded border border-border bg-surface text-xs"
          />
        </label>
        <label className="block">
          <span className="text-[10px] text-text-tertiary block mb-0.5">Descripción / texto promocional</span>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows={2}
            placeholder="Ej: La estación más vendida para uso en interior…"
            className="w-full px-2 py-1.5 rounded border border-border bg-surface text-xs resize-y"
          />
        </label>
      </div>
      <button
        type="submit"
        disabled={!canSave || saving}
        className="px-3 py-1.5 rounded bg-accent text-white text-xs font-medium disabled:opacity-50"
      >
        {saving ? 'Guardando…' : saved ? '✓ Guardado' : 'Guardar'}
      </button>
    </form>
  )
}
