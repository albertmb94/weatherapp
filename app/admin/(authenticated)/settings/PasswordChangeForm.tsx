'use client'

import { useState } from 'react'

export default function PasswordChangeForm() {
  const [current, setCurrent] = useState('')
  const [newPass, setNewPass] = useState('')
  const [confirm, setConfirm] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [saving, setSaving] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (newPass.length < 8) { setMsg({ ok: false, text: 'Mínimo 8 caracteres.' }); return }
    if (newPass !== confirm) { setMsg({ ok: false, text: 'Las contraseñas no coinciden.' }); return }
    setSaving(true)
    setMsg(null)
    try {
      const r = await fetch('/api/admin/auth/change-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ current_password: current, new_password: newPass }),
      })
      const data = await r.json()
      if (r.ok && data.ok) {
        setMsg({ ok: true, text: 'Contraseña actualizada.' })
        setCurrent(''); setNewPass(''); setConfirm('')
      } else {
        setMsg({ ok: false, text: data.error ?? 'Error' })
      }
    } catch {
      setMsg({ ok: false, text: 'Error de red' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <input type="password" value={current} onChange={e => setCurrent(e.target.value)}
        placeholder="Contraseña actual" required autoComplete="current-password"
        className="w-full px-2 py-1.5 rounded border border-border bg-surface text-xs" />
      <input type="password" value={newPass} onChange={e => setNewPass(e.target.value)}
        placeholder="Nueva contraseña (mín. 8)" required minLength={8} autoComplete="new-password"
        className="w-full px-2 py-1.5 rounded border border-border bg-surface text-xs" />
      <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
        placeholder="Confirmar nueva contraseña" required minLength={8} autoComplete="new-password"
        className="w-full px-2 py-1.5 rounded border border-border bg-surface text-xs" />
      <button type="submit" disabled={saving}
        className="w-full py-1.5 rounded bg-accent text-white text-xs font-medium disabled:opacity-50">
        {saving ? 'Guardando…' : 'Cambiar contraseña'}
      </button>
      {msg && <p className={`text-xs ${msg.ok ? 'text-emerald-400' : 'text-red-400'}`}>{msg.text}</p>}
    </form>
  )
}
