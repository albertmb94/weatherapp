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
  description?: string | null
  priceLabel?: string | null
  imageUrl?: string | null
  affiliateUrl: string
  enabled: boolean
  sortOrder: number
}

/** B-NBT-13: extrae ASIN de una URL de Amazon (misma lógica que el API). */
function extractAsinClient(url: string): string | null {
  const m = /(?:\/dp\/|\/gp\/product\/)([A-Z0-9]{10})/i.exec(url)
  return m ? m[1].toUpperCase() : null
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

  // B-NBT-13: toggle enabled sin reenviar el objeto completo.
  const toggle = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      await fetch(`/api/admin/affiliates/${encodeURIComponent(id)}/toggle`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled }),
      })
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
              <th className="px-3 py-2 font-medium">Título / texto</th>
              <th className="px-3 py-2 font-medium">Enlace</th>
              <th className="px-3 py-2 font-medium">Estado</th>
              <th className="px-3 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {(data?.products ?? []).map(p => (
              <tr key={p.id} className="border-t border-border hover:bg-surface-raised align-top">
                <td className="px-3 py-2 font-mono text-[10px]">{p.trigger}</td>
                <td className="px-3 py-2">{p.locale}</td>
                <td className="px-3 py-2 font-mono text-[10px]">{p.asin}</td>
                <td className="px-3 py-2 max-w-[220px]">
                  <div className="truncate">{p.title}</div>
                  {(p as AffiliateProduct & { description?: string }).description ? (
                    <div className="text-[10px] text-text-muted truncate max-w-[200px]">
                      {(p as AffiliateProduct & { description?: string }).description}
                    </div>
                  ) : null}
                </td>
                <td className="px-3 py-2 max-w-[160px]">
                  <a href={p.affiliateUrl} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline break-all text-[10px]">
                    {p.affiliateUrl.length > 50 ? p.affiliateUrl.slice(0, 50) + '…' : p.affiliateUrl}
                  </a>
                </td>
                <td className="px-3 py-2">
                  <button
                    onClick={() => toggle.mutate({ id: p.id, enabled: !p.enabled })}
                    className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${p.enabled ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}
                  >
                    {p.enabled ? 'Activo' : 'Inactivo'}
                  </button>
                </td>
                <td className="px-3 py-2">
                  <button onClick={() => del.mutate(p.id)} className="text-red-400 hover:underline">
                    Borrar
                  </button>
                </td>
              </tr>
            ))}
            {(data?.products ?? []).length === 0 && !isLoading && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-text-tertiary">Sin productos.</td></tr>
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
  const [amazonUrl, setAmazonUrl] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priceLabel, setPriceLabel] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // B-NBT-13: preview del ASIN extraído de la URL pegada.
  const asinPreview = extractAsinClient(amazonUrl)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!amazonUrl.trim() && !asinPreview) {
      setError('Pega una URL de producto de Amazon.')
      return
    }
    setBusy(true)
    setError(null)
    const r = await fetch('/api/admin/affiliates', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        trigger,
        locale,
        amazonUrl: amazonUrl.trim(),
        asin: asinPreview ?? '',
        title,
        description: description || undefined,
        priceLabel: priceLabel || undefined,
        imageUrl: imageUrl || undefined,
        enabled: true,
      }),
    })
    const data = await r.json().catch(() => ({}))
    setBusy(false)
    if (!r.ok || !data.ok) {
      setError(data.message ?? data.error ?? 'Error al guardar')
      return
    }
    setAmazonUrl('')
    setTitle('')
    setDescription('')
    setPriceLabel('')
    setImageUrl('')
    onCreated()
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-border bg-surface-raised p-4 space-y-3">
      <h2 className="text-sm font-semibold">Añadir producto Amazon</h2>
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
        <label className="space-y-1 sm:col-span-3">
          <span className="text-[10px] text-text-tertiary block">URL del producto en Amazon (pega la URL completa)</span>
          <input
            value={amazonUrl}
            onChange={e => setAmazonUrl(e.target.value)}
            required
            placeholder="https://www.amazon.es/Estacion-Meteorologica-Interior/dp/B0XXXXXXXX"
            className="w-full px-2 py-1.5 rounded border border-border bg-surface text-xs font-mono"
          />
          {asinPreview && (
            <span className="text-[10px] text-emerald-400 block">ASIN detectado: {asinPreview}</span>
          )}
        </label>
        <label className="space-y-1 sm:col-span-2">
          <span className="text-[10px] text-text-tertiary block">Título (texto visible)</span>
          <input value={title} onChange={e => setTitle(e.target.value)} required className="w-full px-2 py-1.5 rounded border border-border bg-surface text-xs" />
        </label>
        <label className="space-y-1">
          <span className="text-[10px] text-text-tertiary block">Precio (texto libre)</span>
          <input value={priceLabel} onChange={e => setPriceLabel(e.target.value)} placeholder="12,99 €" className="w-full px-2 py-1.5 rounded border border-border bg-surface text-xs" />
        </label>
        <label className="space-y-1 sm:col-span-3">
          <span className="text-[10px] text-text-tertiary block">Descripción / texto promocional (opcional)</span>
          <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} placeholder="Ej: La estación más vendida para uso en interior con pantalla LCD…" className="w-full px-2 py-1.5 rounded border border-border bg-surface text-xs resize-y" />
        </label>
        <label className="space-y-1 sm:col-span-3">
          <span className="text-[10px] text-text-tertiary block">URL de imagen (opcional)</span>
          <input value={imageUrl} onChange={e => setImageUrl(e.target.value)} placeholder="https://…" className="w-full px-2 py-1.5 rounded border border-border bg-surface text-xs" />
        </label>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      <button type="submit" disabled={busy || !asinPreview} className="px-3 py-1.5 rounded bg-accent text-white text-xs font-medium disabled:opacity-50">
        {busy ? 'Guardando…' : 'Añadir'}
      </button>
    </form>
  )
}
