'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { PLAN_FEATURES, type Plan } from '@/lib/plans.catalog'

export default function PlansPage() {
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'plans'],
    queryFn: async () => {
      const r = await fetch('/api/admin/plans')
      if (!r.ok) throw new Error('Failed to load plans')
      return r.json() as Promise<{ ok: boolean; plans: Plan[] }>
    },
  })

  return (
    <div className="p-6 space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Planes</h1>
        <p className="text-sm text-text-tertiary">
          Edita precios, descripciones y Stripe Price IDs. Los cambios se reflejan en /premium inmediatamente.
        </p>
      </header>
      {isLoading && <div className="text-sm text-text-tertiary">Cargando…</div>}
      <div className="space-y-4">
        {(data?.plans ?? []).map(plan => (
          <PlanCard
            key={plan.id}
            plan={plan}
            onChanged={() => queryClient.invalidateQueries({ queryKey: ['admin', 'plans'] })}
          />
        ))}
      </div>
    </div>
  )
}

function PlanCard({ plan, onChanged }: { plan: Plan; onChanged: () => void }) {
  // Re-seed the local form when the parent supplies a new `plan`
  // (initial load + after save invalidation). We track the plan's
  // updatedAt timestamp so user-typed edits aren't clobbered.
  const [form, setForm] = useState<Plan>(plan)
  const [seededUpdatedAt, setSeededUpdatedAt] = useState<number | null>(plan.updatedAt)
  if (plan.updatedAt !== seededUpdatedAt) {
    setForm(plan)
    setSeededUpdatedAt(plan.updatedAt)
  }
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncedMsg, setSyncedMsg] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/admin/plans/${encodeURIComponent(plan.id)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: form.kind,
          nameEs: form.nameEs,
          nameEn: form.nameEn,
          descriptionEs: form.descriptionEs,
          descriptionEn: form.descriptionEn,
          monthlyPriceCents: form.monthlyPriceCents,
          yearlyPriceCents: form.yearlyPriceCents,
          stripePriceIdMonthly: form.stripePriceIdMonthly,
          stripePriceIdYearly: form.stripePriceIdYearly,
          features: form.features,
          enabled: form.enabled,
          sortOrder: form.sortOrder,
          badgeEs: form.badgeEs,
          badgeEn: form.badgeEn,
        }),
      })
      if (!r.ok) throw new Error('save failed')
      return r.json()
    },
    onMutate: () => {
      setSaving(true)
      setError(null)
      setSaved(false)
    },
    onSuccess: () => {
      setSaved(true)
      onChanged()
      setTimeout(() => setSaved(false), 2000)
    },
    onError: (e: Error) => setError(e.message),
    onSettled: () => setSaving(false),
  })

  async function sync() {
    setSyncing(true)
    setError(null)
    try {
      const r = await fetch(`/api/admin/plans/${encodeURIComponent(plan.id)}/sync`, { method: 'POST' })
      const data = await r.json()
      if (!data.verified) {
        setError(data.message ?? 'No verificado')
      } else {
        setSyncedMsg(`Sincronizado (mensual: ${data.priceIdMonthly}, anual: ${data.priceIdYearly})`)
        onChanged()
        setTimeout(() => setSyncedMsg(''), 4000)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error de red')
    } finally {
      setSyncing(false)
    }
  }

  return (
    <section className="rounded-2xl border border-border bg-surface-raised p-5 space-y-4">
      <header className="flex items-start gap-4">
        <div className="flex-1">
          <h2 className="font-semibold">{plan.nameEs} <span className="text-xs text-text-tertiary">/ {plan.nameEn}</span></h2>
          <code className="text-[10px] text-text-tertiary">{plan.id}</code>
        </div>
        <label className="flex items-center gap-2 cursor-pointer">
          <span className="text-xs text-text-tertiary">enabled</span>
          <button
            type="button"
            onClick={() => setForm(f => ({ ...f, enabled: !f.enabled }))}
            aria-pressed={form.enabled}
            className={`relative w-10 h-5 rounded-full transition-colors ${
              form.enabled ? 'bg-emerald-500' : 'bg-gray-600'
            }`}
          >
            <span
              className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
                form.enabled ? 'translate-x-5' : 'translate-x-0.5'
              }`}
            />
          </button>
        </label>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Nombre (ES)" value={form.nameEs} onChange={v => setForm(f => ({ ...f, nameEs: v }))} />
        <Field label="Nombre (EN)" value={form.nameEn} onChange={v => setForm(f => ({ ...f, nameEn: v }))} />
        <Field
          label="Descripción (ES)"
          value={form.descriptionEs ?? ''}
          onChange={v => setForm(f => ({ ...f, descriptionEs: v }))}
          textarea
        />
        <Field
          label="Descripción (EN)"
          value={form.descriptionEn ?? ''}
          onChange={v => setForm(f => ({ ...f, descriptionEn: v }))}
          textarea
        />
        <Field
          label="Precio mensual (céntimos €)"
          value={String(form.monthlyPriceCents ?? '')}
          type="number"
          onChange={v => setForm(f => ({ ...f, monthlyPriceCents: v ? Number(v) : null }))}
        />
        <Field
          label="Precio anual (céntimos €)"
          value={String(form.yearlyPriceCents ?? '')}
          type="number"
          onChange={v => setForm(f => ({ ...f, yearlyPriceCents: v ? Number(v) : null }))}
        />
        <Field
          label="Stripe Price ID (mensual)"
          value={form.stripePriceIdMonthly ?? ''}
          onChange={v => setForm(f => ({ ...f, stripePriceIdMonthly: v || null }))}
          placeholder="price_xxx"
        />
        <Field
          label="Stripe Price ID (anual)"
          value={form.stripePriceIdYearly ?? ''}
          onChange={v => setForm(f => ({ ...f, stripePriceIdYearly: v || null }))}
          placeholder="price_xxx"
        />
        <Field
          label="Badge (ES)"
          value={form.badgeEs ?? ''}
          onChange={v => setForm(f => ({ ...f, badgeEs: v || null }))}
        />
        <Field
          label="Badge (EN)"
          value={form.badgeEn ?? ''}
          onChange={v => setForm(f => ({ ...f, badgeEn: v || null }))}
        />
        <Field
          label="Orden"
          value={String(form.sortOrder)}
          type="number"
          onChange={v => setForm(f => ({ ...f, sortOrder: Number(v) || 0 }))}
        />
      </div>

      <div>
        <div className="text-xs text-text-tertiary mb-2">Features incluidas</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {PLAN_FEATURES.map(f => {
            const checked = form.features.includes(f.key)
            return (
              <label key={f.key} className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={e =>
                    setForm(prev => ({
                      ...prev,
                      features: e.target.checked
                        ? [...prev.features, f.key]
                        : prev.features.filter(x => x !== f.key),
                    }))
                  }
                />
                <span>{f.labelEs}</span>
              </label>
            )
          })}
        </div>
      </div>

      <footer className="flex items-center gap-2 pt-2 border-t border-border">
        <button
          type="button"
          onClick={() => save.mutate()}
          disabled={saving}
          className="px-4 py-1.5 rounded bg-accent text-white text-xs font-medium disabled:opacity-50"
        >
          {saving ? 'Guardando…' : 'Guardar'}
        </button>
        <button
          type="button"
          onClick={sync}
          disabled={syncing}
          className="px-3 py-1.5 rounded border border-border text-xs text-text-secondary disabled:opacity-50"
        >
          {syncing ? 'Sincronizando…' : 'Sync con Stripe'}
        </button>
        {syncedMsg && <span className="text-xs text-emerald-400">{syncedMsg}</span>}
        {saved && <span className="text-xs text-emerald-400">Guardado</span>}
        {error && <span className="text-xs text-red-400">{error}</span>}
      </footer>
    </section>
  )
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  textarea = false,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  textarea?: boolean
  placeholder?: string
}) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] text-text-tertiary">{label}</span>
      {textarea ? (
        <textarea
          value={value}
          onChange={e => onChange(e.target.value)}
          rows={3}
          className="w-full px-2 py-1.5 rounded border border-border bg-surface text-xs"
        />
      ) : (
        <input
          type={type}
          value={value}
          placeholder={placeholder}
          onChange={e => onChange(e.target.value)}
          className="w-full px-2 py-1.5 rounded border border-border bg-surface text-xs"
        />
      )}
    </label>
  )
}
