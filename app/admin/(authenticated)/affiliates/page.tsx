/**
 * Affiliate admin page — list + edit the product catalog that
 * powers the home-page SponsoredSection. Each row binds a trigger
 * (uv_high, rain_24h, etc.) to a locale-specific ASIN/title/price.
 */

'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

interface AffiliateProduct {
  id: string
  trigger: string
  asin: string
  locale: string
  title: string
  priceLabel: string | null
  imageUrl: string | null
  affiliateUrl: string
  enabled: boolean
  sortOrder: number
}

const TRIGGERS = [
  { key: 'uv_high', labelEs: 'UV alto' },
  { key: 'rain_24h', labelEs: 'Lluvia 24h' },
  { key: 'pollen_high', labelEs: 'Polen alto' },
  { key: 'wind_strong', labelEs: 'Viento fuerte' },
  { key: 'frost', labelEs: 'Heladas' },
  { key: 'heat', labelEs: 'Calor' },
  { key: 'snow', labelEs: 'Nieve' },
  { key: 'fog', labelEs: 'Niebla' },
]

export default function AffiliatesAdminPage() {
  return (
    <div className="p-6 space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Afiliados</h1>
        <p className="text-sm text-text-tertiary">
          Catálogo de productos. Cuando <code>feature.affiliates</code> esté activo y haya productos coincidentes con el forecast del usuario,
          se mostrarán en la app como secciones patrocinadas.
        </p>
      </header>
      <ProductsList />
    </div>
  )
}

function ProductsList() {
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'affiliate-products'],
    queryFn: async () => {
      const r = await fetch('/api/admin/affiliates')
      if (!r.ok) return { ok: false, products: [] }
      return r.json() as Promise<{ ok: boolean; products: AffiliateProduct[] }>
    },
  })

  const del = useMutation({
    mutationFn: async (id: string) => {
      await fetch(`/api/admin/affiliates/${encodeURIComponent(id)}`, { method: 'DELETE' })
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'affiliate-products'] }),
  })

  return (
    <div className="space-y-4">
      <NewProductForm onCreated={() => queryClient.invalidateQueries({ queryKey: ['admin', 'affiliate-products'] })} />
      {isLoading && <div className="text-sm text-text-tertiary">Cargando…</div>}
      <div className="rounded-2xl border border-border overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-surface-raised">
            <tr className="text-left">
              <th className="px-3 py-2 font-medium">Trigger</th>
              <th className="px-3 py-2 font-medium">Locale</th>
              <th className="px-3 py-2 font-medium">ASIN</th>
              <th className="px-3 py-2 font-medium">Título</th>
              <th className="px-3 py-2 font-medium">Estado</th>
              <th className="px-3 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {(data?.products ?? []).map(p => (
              <tr key={p.id} className="border-t border-border hover:bg-surface-raised">
                <td className="px-3 py-2 font-mono text-[10px]">{p.trigger}</td>
                <td className="px-3 py-2">{p.locale}</td>
                <td className="px-3 py-2 font-mono text-[10px]">{p.asin}</td>
                <td className="px-3 py-2 truncate max-w-[200px]">{p.title}</td>
                <td className="px-3 py-2">{p.enabled ? '✅' : '❌'}</td>
                <td className="px-3 py-2">
                  <button onClick={() => del.mutate(p.id)} className="text-red-400 hover:underline">
                    Borrar
                  </button>
                </td>
              </tr>
            ))}
            {(data?.products ?? []).length === 0 && !isLoading && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-text-tertiary">Sin productos.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function NewProductForm({ onCreated }: { onCreated: () => void }) {
  const [trigger, setTrigger] = useState(TRIGGERS[0].key)
  const [locale, setLocale] = useState<'es' | 'en'>('es')
  const [asin, setAsin] = useState('')
  const [title, setTitle] = useState('')
  const [priceLabel, setPriceLabel] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    await fetch('/api/admin/affiliates', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ trigger, locale, asin, title, priceLabel, imageUrl }),
    })
    setAsin('')
    setTitle('')
    setPriceLabel('')
    setImageUrl('')
    setBusy(false)
    onCreated()
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-border bg-surface-raised p-4 space-y-3">
      <h2 className="text-sm font-semibold">Añadir producto</h2>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <label className="space-y-1">
          <span className="text-[10px] text-text-tertiary block">Trigger</span>
          <select value={trigger} onChange={e => setTrigger(e.target.value)} className="w-full px-2 py-1.5 rounded border border-border bg-surface text-xs">
            {TRIGGERS.map(t => <option key={t.key} value={t.key}>{t.labelEs}</option>)}
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-[10px] text-text-tertiary block">Locale</span>
          <select value={locale} onChange={e => setLocale(e.target.value as 'es' | 'en')} className="w-full px-2 py-1.5 rounded border border-border bg-surface text-xs">
            <option value="es">es</option>
            <option value="en">en</option>
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-[10px] text-text-tertiary block">ASIN</span>
          <input value={asin} onChange={e => setAsin(e.target.value)} required className="w-full px-2 py-1.5 rounded border border-border bg-surface text-xs font-mono" />
        </label>
        <label className="space-y-1 sm:col-span-2">
          <span className="text-[10px] text-text-tertiary block">Título</span>
          <input value={title} onChange={e => setTitle(e.target.value)} required className="w-full px-2 py-1.5 rounded border border-border bg-surface text-xs" />
        </label>
        <label className="space-y-1">
          <span className="text-[10px] text-text-tertiary block">Precio (texto libre)</span>
          <input value={priceLabel} onChange={e => setPriceLabel(e.target.value)} placeholder="12,99 €" className="w-full px-2 py-1.5 rounded border border-border bg-surface text-xs" />
        </label>
        <label className="space-y-1 sm:col-span-3">
          <span className="text-[10px] text-text-tertiary block">URL de imagen (opcional)</span>
          <input value={imageUrl} onChange={e => setImageUrl(e.target.value)} placeholder="https://…" className="w-full px-2 py-1.5 rounded border border-border bg-surface text-xs" />
        </label>
      </div>
      <button type="submit" disabled={busy} className="px-3 py-1.5 rounded bg-accent text-white text-xs font-medium disabled:opacity-50">
        {busy ? 'Guardando…' : 'Añadir'}
      </button>
    </form>
  )
}
