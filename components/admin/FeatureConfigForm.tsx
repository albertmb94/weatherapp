'use client'

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'

export interface ConfigField {
  key: string
  label: string
  type?: 'string' | 'password' | 'textarea' | 'url'
  placeholder?: string
}

interface FeatureConfigFormProps {
  featureKey: string
  title: string
  description: string
  fields: ConfigField[]
  /** Current config values from the server (or null while loading). */
  initialConfig: Record<string, unknown> | null
  enabled: boolean
  onToggleEnabled: (enabled: boolean) => void
}

/**
 * B-NBT-17: reusable form that reads/writes `feature_flags.config`
 * via PUT /api/admin/features/[key]. Used by Ads, Donations, Push.
 */
export default function FeatureConfigForm({
  featureKey,
  title,
  description,
  fields,
  initialConfig,
  enabled,
  onToggleEnabled,
}: FeatureConfigFormProps) {
  const queryClient = useQueryClient()
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    for (const f of fields) init[f.key] = String(initialConfig?.[f.key] ?? '')
    return init
  })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function setValue(key: string, val: string) {
    setValues(prev => ({ ...prev, [key]: val }))
    setSaved(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      // Read current full config so we don't lose unrelated keys
      const get = await fetch(`/api/admin/features/${featureKey}`)
      const current = await get.json().catch(() => ({ config: {} }))
      const mergedConfig = { ...current.config, ...values }
      const r = await fetch(`/api/admin/features/${featureKey}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled, config: mergedConfig }),
      })
      if (!r.ok) throw new Error(await r.text().catch(() => 'save_failed'))
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      queryClient.invalidateQueries({ queryKey: ['admin', 'features'] })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-2xl border border-border bg-surface-raised p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">{title}</h2>
        <button
          type="button"
          onClick={() => onToggleEnabled(!enabled)}
          className={`px-2 py-0.5 rounded text-[10px] font-medium ${enabled ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}
        >
          {enabled ? 'Activo' : 'Inactivo'}
        </button>
      </div>
      <p className="text-[11px] text-text-muted">{description}</p>
      <div className="space-y-2">
        {fields.map(f => (
          <label key={f.key} className="block">
            <span className="text-[10px] text-text-tertiary block mb-0.5">{f.label}</span>
            {f.type === 'textarea' ? (
              <textarea value={values[f.key] ?? ''} onChange={e => setValue(f.key, e.target.value)} rows={2}
                placeholder={f.placeholder} className="w-full px-2 py-1.5 rounded border border-border bg-surface text-xs resize-y" />
            ) : (
              <input
                type={f.type === 'password' ? 'password' : f.type === 'url' ? 'url' : 'text'}
                value={values[f.key] ?? ''}
                onChange={e => setValue(f.key, e.target.value)}
                placeholder={f.placeholder}
                className="w-full px-2 py-1.5 rounded border border-border bg-surface text-xs"
              />
            )}
          </label>
        ))}
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {saved && <p className="text-xs text-emerald-400">✓ Guardado</p>}
      <button type="submit" disabled={saving}
        className="px-3 py-1.5 rounded bg-accent text-white text-xs font-medium disabled:opacity-50">
        {saving ? 'Guardando…' : 'Guardar'}
      </button>
    </form>
  )
}
