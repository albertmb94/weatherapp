'use client'

import { useState } from 'react'

interface CheckoutButtonProps {
  kind: 'premium' | 'stations'
  endpoint: string
  label: string
  /** Shown when the admin hasn't enabled the checkout flags yet. */
  disabledLabel?: string
  enabled: boolean
}

/**
 * B-NBT-10 (Fase 5): client button that starts a Stripe Checkout
 * session and follows the returned URL. When the backend answers 503
 * (flags OFF / not configured) it degrades to a disabled "Próximamente"
 * state with the reason in the title.
 */
export default function CheckoutButton({
  kind,
  endpoint,
  label,
  disabledLabel = 'Próximamente',
  enabled,
}: CheckoutButtonProps) {
  const [loading, setLoading] = useState(false)
  const [reason, setReason] = useState<string | null>(null)

  if (!enabled) {
    return (
      <button
        disabled
        title={reason ?? undefined}
        className="w-full py-2 rounded-lg bg-accent text-white text-sm font-medium opacity-50 cursor-not-allowed"
      >
        {disabledLabel}
      </button>
    )
  }

  async function start() {
    setLoading(true)
    setReason(null)
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind, plan: 'yearly' }),
      })
      const data = (await res.json()) as { ok?: boolean; url?: string; message?: string; error?: string }
      if (data.ok && data.url) {
        window.location.href = data.url
        return
      }
      setReason(data.message ?? data.error ?? null)
    } catch {
      setReason('network_error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      onClick={start}
      disabled={loading}
      title={reason ?? undefined}
      className="w-full py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/90 transition-colors disabled:opacity-50"
    >
      {loading ? '…' : label}
    </button>
  )
}
