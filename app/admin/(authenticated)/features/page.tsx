'use client'

import { useState, useCallback } from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { FEATURE_CATALOG } from '@/lib/features'

interface FlagRow {
  key: string
  enabled: boolean
  config: Record<string, unknown>
  description: string | null
  updatedAt: number | null
}

export default function FeaturesPage() {
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'features'],
    queryFn: async () => {
      const r = await fetch('/api/admin/features')
      if (!r.ok) throw new Error('Failed to load features')
      return r.json() as Promise<{ ok: boolean; features: FlagRow[] }>
    },
  })

  const features = data?.features ?? []

  const byKey = new Map<string, FlagRow>(features.map(f => [f.key, f]))

  // B-NBT-10: activation checklist for the Stripe payment path. Warn
  // BEFORE the admin flips the flags — checkout answers 503 with a
  // clear reason when any of these is missing.
  const stripe = byKey.get('feature.stripe')
  const premiumCheckout = byKey.get('feature.premium_checkout')
  const stationsCheckout = byKey.get('feature.stations_checkout')
  const wantsStripe =
    stripe?.enabled || premiumCheckout?.enabled || stationsCheckout?.enabled
  const cfg = (stripe?.config ?? {}) as Record<string, unknown>
  const missingStripe: string[] = []
  if (typeof cfg.secret_key !== 'string' || !(cfg.secret_key as string).startsWith('sk_')) {
    missingStripe.push('Secret Key (sk_…)')
  }
  if (typeof cfg.webhook_secret !== 'string' || (cfg.webhook_secret as string).length < 8) {
    missingStripe.push('Webhook Signing Secret')
  }
  if (wantsStripe && missingStripe.length > 0) {
    console.warn('[features] stripe config incomplete', missingStripe)
  }

  // Group by category
  const grouped = FEATURE_CATALOG.reduce<Record<string, typeof FEATURE_CATALOG>>((acc, meta) => {
    if (!acc[meta.category]) acc[meta.category] = []
    acc[meta.category].push(meta)
    return acc
  }, {})

  return (
    <div className="p-6 space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Feature flags</h1>
        <p className="text-sm text-text-tertiary">
          Cada toggle cambia el comportamiento de la app en tiempo real. Los cambios se reflejan tras un refresh (cache de 30 s en cliente).
        </p>
      </header>

      {isLoading && <div className="text-sm text-text-tertiary">Cargando…</div>}

      {wantsStripe && missingStripe.length > 0 && (
        <div
          role="alert"
          className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-xs text-amber-200"
        >
          <strong className="font-semibold">Stripe incompleto.</strong>{' '}
          Falta configurar: {missingStripe.join(', ')} en «Stripe (pagos)».
          El checkout responderá 503 hasta que lo rellenes.
        </div>
      )}

      <div className="space-y-6">
        {Object.entries(grouped).map(([category, items]) => (
          <section key={category} className="space-y-3">
            <h2 className="text-xs uppercase tracking-wider text-text-tertiary font-semibold">{category}</h2>
            <div className="space-y-2">
              {items.map(meta => {
                const flag = byKey.get(meta.key)
                return (
                  <FeatureRow
                    key={meta.key}
                    meta={meta}
                    flag={flag}
                    onChanged={() => queryClient.invalidateQueries({ queryKey: ['admin', 'features'] })}
                  />
                )
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}

function FeatureRow({
  meta,
  flag,
  onChanged,
}: {
  meta: (typeof FEATURE_CATALOG)[number]
  flag: FlagRow | undefined
  onChanged: () => void
}) {
  const enabled = flag?.enabled ?? false
  const [showConfig, setShowConfig] = useState(false)
  // Re-seed when the flag's remote updatedAt changes (initial load or after save).
  const [seededUpdatedAt, setSeededUpdatedAt] = useState<number | null>(null)
  const [configJson, setConfigJson] = useState(
    JSON.stringify(flag?.config ?? {}, null, 2),
  )
  if (flag && flag.updatedAt !== null && seededUpdatedAt !== flag.updatedAt) {
    setConfigJson(JSON.stringify(flag.config, null, 2))
    setSeededUpdatedAt(flag.updatedAt)
  }
  const [savingConfig, setSavingConfig] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const toggleMutation = useMutation({
    mutationFn: async (next: boolean) => {
      let config: Record<string, unknown> = {}
      try {
        config = JSON.parse(configJson)
      } catch {
        config = flag?.config ?? {}
      }
      const r = await fetch(`/api/admin/features/${encodeURIComponent(meta.key)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: next, config, description: meta.description }),
      })
      if (!r.ok) throw new Error('save failed')
      return r.json()
    },
    onSuccess: () => {
      onChanged()
    },
    onError: (e: Error) => setError(e.message),
  })

  const saveConfig = useCallback(async () => {
    setSavingConfig(true)
    setError(null)
    try {
      JSON.parse(configJson) // validate
      const r = await fetch(`/api/admin/features/${encodeURIComponent(meta.key)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          enabled,
          config: JSON.parse(configJson),
          description: meta.description,
        }),
      })
      if (!r.ok) throw new Error('save failed')
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'JSON inválido')
    } finally {
      setSavingConfig(false)
    }
  }, [configJson, enabled, meta.description, meta.key, onChanged])

  return (
    <div className="rounded-2xl border border-border bg-surface-raised p-4 space-y-3">
      <div className="flex items-start gap-4">
        <button
          type="button"
          onClick={() => toggleMutation.mutate(!enabled)}
          disabled={toggleMutation.isPending}
          aria-pressed={enabled}
          className={`relative w-12 h-6 rounded-full transition-colors shrink-0 ${
            enabled ? 'bg-emerald-500' : 'bg-gray-600'
          } disabled:opacity-50`}
        >
          <span
            className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
              enabled ? 'translate-x-6' : 'translate-x-0.5'
            }`}
          />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <div className="font-medium text-sm">{meta.label}</div>
            <code className="text-[10px] text-text-tertiary">{meta.key}</code>
          </div>
          <div className="text-xs text-text-tertiary mt-0.5">{meta.description}</div>
        </div>
        {meta.configSchema && meta.configSchema.length > 0 && (
          <button
            type="button"
            onClick={() => setShowConfig(s => !s)}
            className="text-xs text-accent hover:underline shrink-0"
          >
            {showConfig ? 'Ocultar config' : 'Config'}
          </button>
        )}
      </div>
      {showConfig && meta.configSchema && (
        <div className="space-y-2 pt-2 border-t border-border">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {meta.configSchema.map(field => (
              <SchemaField
                key={field.key}
                field={field}
                value={(flag?.config as Record<string, unknown>)?.[field.key]}
                onChange={v => {
                  try {
                    const cur = JSON.parse(configJson) as Record<string, unknown>
                    cur[field.key] = v
                    setConfigJson(JSON.stringify(cur, null, 2))
                  } catch {
                    /* ignore parse errors while editing */
                  }
                }}
              />
            ))}
          </div>
          <details className="text-xs">
            <summary className="cursor-pointer text-text-tertiary">JSON crudo</summary>
            <textarea
              value={configJson}
              onChange={e => setConfigJson(e.target.value)}
              rows={Math.min(8, configJson.split('\n').length + 1)}
              className="w-full mt-2 px-2 py-1.5 rounded border border-border bg-surface font-mono text-[11px]"
            />
          </details>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={saveConfig}
              disabled={savingConfig}
              className="px-3 py-1.5 rounded bg-accent text-white text-xs font-medium disabled:opacity-50"
            >
              {savingConfig ? 'Guardando…' : 'Guardar config'}
            </button>
            {error && <span className="text-xs text-red-400">{error}</span>}
          </div>
        </div>
      )}
    </div>
  )
}

function SchemaField({
  field,
  value,
  onChange,
}: {
  field: { key: string; label: string; type: 'string' | 'number' | 'boolean' | 'url'; secret?: boolean }
  value: unknown
  onChange: (v: string) => void
}) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] text-text-tertiary">
        {field.label}
        {field.secret && <span className="ml-1 text-amber-400">🔒</span>}
      </span>
      <input
        type={field.secret ? 'password' : field.type === 'number' ? 'number' : 'text'}
        value={typeof value === 'string' ? value : value != null ? String(value) : ''}
        onChange={e => onChange(e.target.value)}
        className="w-full px-2 py-1.5 rounded border border-border bg-surface text-xs font-mono"
      />
    </label>
  )
}
