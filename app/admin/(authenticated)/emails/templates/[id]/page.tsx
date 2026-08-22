'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

interface TemplateDetail {
  id: string
  name: string
  subjectEs: string
  subjectEn: string
  bodyEs: string
  bodyEn: string
  variables: string[]
  category: string
  enabled: boolean
  updatedAt: number | null
}

export default function TemplateEditorPage() {
  const params = useParams<{ id: string }>()
  const id = decodeURIComponent(params.id)
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'email-template', id],
    queryFn: async () => {
      const r = await fetch(`/api/admin/emails/templates/${encodeURIComponent(id)}`)
      if (!r.ok) throw new Error('not found')
      return r.json() as Promise<{ ok: boolean; template: TemplateDetail }>
    },
  })

  // Initialise form from query result. The query result may arrive
  // asynchronously, so we seed the form the first time `data` lands.
  // Subsequent edits live in local state and we only re-seed if the
  // remote `updatedAt` ticks (e.g. after a save roundtrip).
  const [form, setForm] = useState<TemplateDetail | null>(null)
  const [seededUpdatedAt, setSeededUpdatedAt] = useState<number | null>(null)
  const remote = data?.template
  const remoteUpdatedAt = remote?.updatedAt ?? null
  if (remote && form == null) {
    setForm(remote)
    setSeededUpdatedAt(remoteUpdatedAt)
  } else if (remote && remoteUpdatedAt !== null && remoteUpdatedAt !== seededUpdatedAt && form) {
    // After save: server returns a fresh updatedAt; sync the form
    // so a second tab doesn't keep stale data. We deliberately
    // don't reset user-typed state mid-edit, only after the
    // remote timestamp has moved.
    setForm(remote)
    setSeededUpdatedAt(remoteUpdatedAt)
  }

  const save = useMutation({
    mutationFn: async () => {
      if (!form) return
      const r = await fetch(`/api/admin/emails/templates/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          subjectEs: form.subjectEs,
          subjectEn: form.subjectEn,
          bodyEs: form.bodyEs,
          bodyEn: form.bodyEn,
          variables: form.variables,
          category: form.category,
          enabled: form.enabled,
        }),
      })
      if (!r.ok) throw new Error('save failed')
      return r.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'email-template', id] })
    },
  })

  const sendTest = useMutation({
    mutationFn: async (locale: 'es' | 'en') => {
      const r = await fetch(`/api/admin/emails/templates/${encodeURIComponent(id)}/test`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ locale }),
      })
      return r.json() as Promise<{ ok: boolean; error?: string }>
    },
  })

  if (isLoading || !form) return <div className="p-6 text-sm text-text-tertiary">Cargando…</div>

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <header className="flex items-center gap-3">
        <Link href="/admin/emails" className="text-xs text-text-tertiary hover:underline">← Emails</Link>
        <h1 className="text-lg font-semibold">{form.name}</h1>
        <code className="text-[10px] text-text-tertiary">{form.id}</code>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="space-y-3">
          <h2 className="text-sm font-semibold">Español</h2>
          <Field label="Asunto" value={form.subjectEs} onChange={v => setForm(f => f ? { ...f, subjectEs: v } : f)} />
          <Field label="Body (markdown)" value={form.bodyEs} onChange={v => setForm(f => f ? { ...f, bodyEs: v } : f)} textarea rows={14} />
        </section>
        <section className="space-y-3">
          <h2 className="text-sm font-semibold">English</h2>
          <Field label="Subject" value={form.subjectEn} onChange={v => setForm(f => f ? { ...f, subjectEn: v } : f)} />
          <Field label="Body (markdown)" value={form.bodyEn} onChange={v => setForm(f => f ? { ...f, bodyEn: v } : f)} textarea rows={14} />
        </section>
      </div>

      <section className="rounded-2xl border border-border bg-surface-raised p-4 space-y-2">
        <h3 className="text-xs font-semibold">Variables disponibles</h3>
        <div className="flex flex-wrap gap-1">
          {form.variables.map(v => (
            <code key={v} className="text-[10px] bg-surface px-1.5 py-0.5 rounded border border-border">{v}</code>
          ))}
          {form.variables.length === 0 && <span className="text-xs text-text-tertiary">Ninguna (texto plano).</span>}
        </div>
        <p className="text-[10px] text-text-tertiary">
          Edita las variables en formato <code>{'{{nombre}}'}</code> en el body. Soporta <code># h1</code>, <code>## h2</code>, <code>**bold**</code>, <code>*italic*</code>, <code>- listas</code> y <code>[texto](url)</code>.
        </p>
      </section>

      <section className="flex items-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className="px-4 py-1.5 rounded bg-accent text-white text-xs font-medium disabled:opacity-50"
        >
          {save.isPending ? 'Guardando…' : 'Guardar'}
        </button>
        <button
          type="button"
          onClick={() => sendTest.mutate('es')}
          disabled={sendTest.isPending}
          className="px-3 py-1.5 rounded border border-border text-xs"
        >
          {sendTest.isPending ? 'Enviando…' : 'Test send (ES)'}
        </button>
        <button
          type="button"
          onClick={() => sendTest.mutate('en')}
          disabled={sendTest.isPending}
          className="px-3 py-1.5 rounded border border-border text-xs"
        >
          {sendTest.isPending ? 'Enviando…' : 'Test send (EN)'}
        </button>
        <label className="flex items-center gap-2 ml-auto">
          <span className="text-xs text-text-tertiary">enabled</span>
          <button
            type="button"
            onClick={() => setForm(f => f ? { ...f, enabled: !f.enabled } : f)}
            aria-pressed={form.enabled}
            className={`relative w-10 h-5 rounded-full transition-colors ${
              form.enabled ? 'bg-emerald-500' : 'bg-gray-600'
            }`}
          >
            <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${form.enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
          </button>
        </label>
      </section>
      {save.isSuccess && <p className="text-xs text-emerald-400">Guardado.</p>}
      {save.error && <p className="text-xs text-red-400">Error al guardar.</p>}
      {sendTest.data && !sendTest.data.ok && <p className="text-xs text-red-400">Test send: {sendTest.data.error}</p>}
      {sendTest.data?.ok && <p className="text-xs text-emerald-400">Test enviado.</p>}
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  textarea = false,
  rows = 4,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  textarea?: boolean
  rows?: number
}) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] text-text-tertiary">{label}</span>
      {textarea ? (
        <textarea
          value={value}
          onChange={e => onChange(e.target.value)}
          rows={rows}
          className="w-full px-2 py-1.5 rounded border border-border bg-surface text-xs font-mono"
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          className="w-full px-2 py-1.5 rounded border border-border bg-surface text-xs"
        />
      )}
    </label>
  )
}
