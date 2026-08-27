'use client'

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'

export interface ConfigField {
  key: string
  label: string
  type?: 'string' | 'password' | 'textarea' | 'url'
  placeholder?: string
}

/**
 * B-NBT-18 FIX: formulario de configuración SIN toggle de enabled.
 * El toggle Activo/Inactivo vive en /admin/features, no aquí.
 * Esto elimina el crash de pasar funciones como props entre
 * Server y Client Components (no serializables).
 */
export default function FeatureConfigForm({
  featureKey,
  title,
  description,
  fields,
  initialConfig,
}: {
  featureKey: string
  title: string
  description: string
  fields: ConfigField[]
  initialConfig?: Record<string, unknown> | null
}) {
  const queryClient = useQueryClient()
  const [formValues, setFormValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    for (const f of fields) init[f.key] = String(initialConfig?.[f.key] ?? '')
    return init
  })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function setValue(key: string, val: string) {
    setFormValues(prev => ({ ...prev, [key]: val }))
    setSaved(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      // Read current full config SO WE DON'T OVERWRITE SECRETS or the
      // enabled state: the toggle lives in /admin/features and saving
      // config here must NOT force-enable the flag (auditoría F1).
      //
      // AUDITORÍA (segunda pasada): la lectura fallaba EN SILENCIO. Con
      // `.catch(() => ({ feature: null }))`, un GET caído daba
      // `currentEnabled = false` y `mergedConfig = { ...undefined,
      // ...nonEmpty }`. El PUT posterior escribía entonces
      // `enabled: false` y una config recortada a los campos visibles en
      // pantalla: un fallo de red pasajero mientras alguien guardaba la
      // URL de Ko-fi APAGABA Stripe/AdSense/Cookiebot y borraba sus
      // claves. Ahora se aborta antes de tocar nada.
      const get = await fetch(`/api/admin/features/${featureKey}`)
      if (!get.ok) {
        throw new Error(
          'No se pudo leer la configuración actual (' + get.status + '). ' +
            'No se ha guardado nada para no sobrescribir la config existente.',
        )
      }
      let current: { feature?: { enabled?: boolean; config?: Record<string, unknown> } }
      try {
        current = await get.json()
      } catch {
        throw new Error('Respuesta ilegible al leer la configuración actual. No se ha guardado nada.')
      }
      if (!current.feature) {
        throw new Error('La respuesta no contiene la feature. No se ha guardado nada.')
      }
      const currentEnabled = current.feature.enabled === true
      // Skip empty strings so secrets aren't overwritten with blanks
      const nonEmpty = Object.fromEntries(
        Object.entries(formValues).filter(([, v]) => v !== ''),
      )
      const mergedConfig = { ...current.feature.config, ...nonEmpty }
      const r = await fetch(`/api/admin/features/${featureKey}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          enabled: currentEnabled,
          config: mergedConfig,
        }),
      })
      if (!r.ok) throw new Error(await r.text().catch(() => 'save_failed'))
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      queryClient.invalidateQueries({ queryKey: ['admin', 'features'] })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-surface-raised p-4 space-y-3">
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="text-[11px] text-text-muted">{description}</p>
      <form onSubmit={handleSubmit} className="space-y-2">
        {fields.map(f => (
          <label key={f.key} className="block">
            <span className="text-[10px] text-text-tertiary block mb-0.5">{f.label}</span>
            {f.type === 'textarea' ? (
              <textarea value={formValues[f.key] ?? ''} onChange={e => setValue(f.key, e.target.value)} rows={2}
                placeholder={f.placeholder} className="w-full px-2 py-1.5 rounded border border-border bg-surface text-xs resize-y" />
            ) : (
              <input type={f.type === 'password' ? 'password' : f.type === 'url' ? 'url' : 'text'}
                value={formValues[f.key] ?? ''} onChange={e => setValue(f.key, e.target.value)}
                placeholder={f.placeholder} className="w-full px-2 py-1.5 rounded border border-border bg-surface text-xs" />
            )}
          </label>
        ))}
      </form>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {saved && <p className="text-xs text-emerald-400">✓ Guardado</p>}
      <button type="button" onClick={handleSubmit} disabled={saving}
        className="px-3 py-1.5 rounded bg-accent text-white text-xs font-medium disabled:opacity-50">
        {saving ? 'Guardando…' : saved ? '✓ Guardado' : 'Guardar'}
      </button>
    </div>
  )
}
