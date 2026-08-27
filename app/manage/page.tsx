/**
 * Manage subscriptions — placeholder. Once the Stripe Customer Portal
 * integration is live the user lands here, we create a portal session
 * via `app/api/stripe/portal`, and redirect them to Stripe. For now
 * we render a "coming soon" stub.
 */

import { cookies } from 'next/headers'
import Link from 'next/link'
import { ENTITLEMENT_COOKIE_NAME, resolveEntitlements } from '@/lib/entitlements'

export default async function ManagePage() {
  const cookieStore = await cookies()
  const token = cookieStore.get(ENTITLEMENT_COOKIE_NAME)?.value
  const ent = await resolveEntitlements(token)

  return (
    <div className="max-w-2xl mx-auto px-4 py-10 space-y-6">
      <h1 className="text-2xl font-semibold">Gestionar suscripción</h1>

      <section className="rounded-2xl border border-border bg-surface-raised p-5 space-y-3">
        <h2 className="text-sm font-semibold">Estado actual</h2>
        <ul className="text-sm space-y-1">
          <li>Premium: <strong>{ent.premium ? 'Activo' : 'Inactivo'}</strong></li>
          <li>Estaciones (add-on): <strong>{ent.stations ? 'Activo' : 'Inactivo'}</strong></li>
        </ul>
      </section>

      <section className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
        <p>
          El portal de cliente de Stripe se conectará aquí cuando la integración esté activa.
          Mientras tanto, contacta por email para gestionar tu suscripción.
        </p>
      </section>

      <div className="flex gap-2 text-sm">
        <Link href="/premium" className="px-4 py-2 rounded border border-border">Ver planes</Link>
        <Link href="/" className="px-4 py-2 rounded border border-border">← App</Link>
      </div>
    </div>
  )
}
