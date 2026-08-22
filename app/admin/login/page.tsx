'use client'

import { useState, type FormEvent } from 'react'

export default function AdminLoginPage() {
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<{ kind: 'idle' | 'sent' | 'error'; message?: string }>({ kind: 'idle' })

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!email.includes('@')) {
      setResult({ kind: 'error', message: 'Email inválido' })
      return
    }
    setSubmitting(true)
    setResult({ kind: 'idle' })
    try {
      const r = await fetch('/api/admin/auth/request', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = await r.json()
      if (data.ok && data.sent) {
        setResult({ kind: 'sent', message: data.delivered ? 'Te hemos enviado un magic link.' : 'Magic link generado. Revisa la consola del servidor.' })
      } else if (data.ok && !data.sent) {
        setResult({ kind: 'sent', message: 'Si el email está registrado, te enviaremos un magic link.' })
      } else {
        setResult({ kind: 'error', message: data.error ?? 'Error desconocido' })
      }
    } catch (err) {
      setResult({ kind: 'error', message: err instanceof Error ? err.message : 'Error de red' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background text-foreground p-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface-raised p-6 space-y-4">
        <div>
          <h1 className="text-lg font-semibold">Weather Admin</h1>
          <p className="text-xs text-text-tertiary mt-1">Introduce tu email para recibir un magic link.</p>
        </div>
        <form onSubmit={onSubmit} className="space-y-3">
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="tu-email@dominio.com"
            required
            autoFocus
            className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm"
          />
          <button
            type="submit"
            disabled={submitting}
            className="w-full py-2 rounded-lg bg-accent text-white text-sm font-medium disabled:opacity-50"
          >
            {submitting ? 'Enviando…' : 'Enviar magic link'}
          </button>
        </form>
        {result.kind === 'sent' && (
          <p className="text-xs text-emerald-400">{result.message}</p>
        )}
        {result.kind === 'error' && (
          <p className="text-xs text-red-400">{result.message}</p>
        )}
      </div>
    </div>
  )
}
