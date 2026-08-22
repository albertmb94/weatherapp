'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'next/navigation'
import Link from 'next/link'

interface UserDetail {
  email: string
  subscriptions: {
    kind: string
    status: string
    plan: string
    currentPeriodEnd: number
    stripeSubscriptionId: string
    createdAt: number
  }[]
  grants: {
    id: string
    kind: string
    reason: string | null
    grantedBy: string
    grantedAt: number
    expiresAt: number | null
    revokedAt: number | null
  }[]
}

export default function UserDetailPage() {
  const params = useParams<{ email: string }>()
  const email = decodeURIComponent(params.email)
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'users', email],
    queryFn: async () => {
      const r = await fetch(`/api/admin/users/${encodeURIComponent(email)}`)
      if (!r.ok) throw new Error('not found')
      return r.json() as Promise<{ ok: boolean; user: UserDetail }>
    },
  })

  const user = data?.user

  return (
    <div className="p-6 space-y-6">
      <header className="flex items-center gap-3">
        <Link href="/admin/users" className="text-xs text-text-tertiary hover:underline">← Usuarios</Link>
        <h1 className="text-lg font-semibold">{email}</h1>
      </header>

      {isLoading && <div className="text-sm text-text-tertiary">Cargando…</div>}

      {user && (
        <>
          <section className="rounded-2xl border border-border bg-surface-raised p-4 space-y-3">
            <h2 className="text-sm font-semibold">Suscripciones</h2>
            {user.subscriptions.length === 0 ? (
              <p className="text-xs text-text-tertiary">Sin suscripciones.</p>
            ) : (
              <div className="space-y-2">
                {user.subscriptions.map((s, i) => (
                  <div key={i} className="flex items-center gap-3 text-xs border-b border-border pb-2 last:border-b-0">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                      s.status === 'active' ? 'bg-emerald-500/15 text-emerald-400' :
                      s.status === 'canceled' ? 'bg-red-500/15 text-red-400' :
                      'bg-amber-500/15 text-amber-400'
                    }`}>{s.status}</span>
                    <span className="font-medium">{s.kind}</span>
                    <span className="text-text-tertiary">{s.plan}</span>
                    <span className="text-text-tertiary ml-auto">
                      hasta {new Date(s.currentPeriodEnd).toLocaleDateString()}
                    </span>
                    {s.stripeSubscriptionId.startsWith('manual_') && (
                      <span className="text-[10px] text-amber-400">GRANT MANUAL</span>
                    )}
                  </div>
                ))}
              </div>
            )}
            <GrantForm email={email} onGranted={() => queryClient.invalidateQueries({ queryKey: ['admin', 'users', email] })} />
          </section>

          <section className="rounded-2xl border border-border bg-surface-raised p-4 space-y-3">
            <h2 className="text-sm font-semibold">Historial de grants</h2>
            {user.grants.length === 0 ? (
              <p className="text-xs text-text-tertiary">Sin grants manuales.</p>
            ) : (
              <ul className="space-y-1 text-xs">
                {user.grants.map(g => (
                  <li key={g.id} className="flex items-center gap-2">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                      g.revokedAt ? 'bg-red-500/15 text-red-400' : 'bg-emerald-500/15 text-emerald-400'
                    }`}>{g.kind}</span>
                    <span className="text-text-tertiary">{new Date(g.grantedAt).toLocaleString()}</span>
                    <span className="text-text-tertiary">por {g.grantedBy}</span>
                    {g.reason && <span className="text-text-secondary">— {g.reason}</span>}
                    {g.expiresAt && <span className="text-text-tertiary">hasta {new Date(g.expiresAt).toLocaleDateString()}</span>}
                    {g.revokedAt && <span className="text-red-400">revocado</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <RevokeButtons
            email={email}
            active={user.subscriptions.filter(s => s.status === 'active').map(s => s.kind)}
            onChanged={() => queryClient.invalidateQueries({ queryKey: ['admin', 'users', email] })}
          />
        </>
      )}
    </div>
  )
}

function GrantForm({ email, onGranted }: { email: string; onGranted: () => void }) {
  const [kind, setKind] = useState<'premium' | 'stations'>('premium')
  const [reason, setReason] = useState('')
  const [months, setMonths] = useState(12)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  async function submit() {
    setBusy(true)
    setResult(null)
    const expiresAt = Date.now() + months * 30 * 24 * 60 * 60 * 1000
    const r = await fetch(`/api/admin/users/${encodeURIComponent(email)}/grant`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind, reason, expiresAt, plan: months >= 12 ? 'yearly' : 'monthly' }),
    })
    setBusy(false)
    if (r.ok) {
      setResult('✅ Grant creado')
      onGranted()
    } else {
      const d = await r.json().catch(() => ({}))
      setResult(`❌ ${d.error ?? 'Error'}`)
    }
  }

  return (
    <div className="pt-3 border-t border-border space-y-2">
      <h3 className="text-xs font-semibold">Conceder grant manual</h3>
      <div className="flex flex-wrap gap-2 items-end">
        <label className="space-y-1">
          <span className="text-[10px] text-text-tertiary block">Tipo</span>
          <select
            value={kind}
            onChange={e => setKind(e.target.value as 'premium' | 'stations')}
            className="px-2 py-1 rounded border border-border bg-surface text-xs"
          >
            <option value="premium">Premium</option>
            <option value="stations">Estaciones</option>
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-[10px] text-text-tertiary block">Duración (meses)</span>
          <input
            type="number"
            min={1}
            value={months}
            onChange={e => setMonths(Number(e.target.value) || 1)}
            className="w-24 px-2 py-1 rounded border border-border bg-surface text-xs"
          />
        </label>
        <label className="space-y-1 flex-1 min-w-[200px]">
          <span className="text-[10px] text-text-tertiary block">Motivo</span>
          <input
            type="text"
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="Beta tester, soporte, etc."
            className="w-full px-2 py-1 rounded border border-border bg-surface text-xs"
          />
        </label>
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="px-3 py-1 rounded bg-accent text-white text-xs font-medium disabled:opacity-50"
        >
          {busy ? 'Creando…' : 'Conceder'}
        </button>
      </div>
      {result && <p className="text-xs">{result}</p>}
    </div>
  )
}

function RevokeButtons({
  email,
  active,
  onChanged,
}: {
  email: string
  active: string[]
  onChanged: () => void
}) {
  async function revoke(kind: string) {
    if (!confirm(`¿Revocar ${kind}?`)) return
    await fetch(`/api/admin/users/${encodeURIComponent(email)}/grant?kind=${kind}`, { method: 'DELETE' })
    onChanged()
  }
  if (active.length === 0) return null
  return (
    <section className="rounded-2xl border border-red-500/30 bg-red-500/5 p-4 space-y-2">
      <h2 className="text-sm font-semibold text-red-400">Revocar</h2>
      <div className="flex gap-2">
        {active.map(kind => (
          <button
            key={kind}
            type="button"
            onClick={() => revoke(kind)}
            className="px-3 py-1.5 rounded border border-red-500/40 text-red-400 text-xs hover:bg-red-500/10"
          >
            Revocar {kind}
          </button>
        ))}
      </div>
    </section>
  )
}
