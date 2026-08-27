/**
 * Public-facing claim page. The Stripe webhook will eventually email
 *  the user a magic-link that lands here with an entitlement token
 *  in the URL; the page sets the entitlement cookie and bounces back
 *  to the home page. Until the Stripe integration is wired up, this
 *  page just renders a "coming soon" placeholder.
 */

import { cookies } from 'next/headers'
import Link from 'next/link'
import { ENTITLEMENT_COOKIE_NAME, ENTITLEMENT_TOKEN_TTL_MS, findEmailByToken, resolveEntitlements } from '@/lib/entitlements'
import { linkVisitorIdentity } from '@/lib/analytics'

export default async function PremiumClaimPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const sp = await searchParams
  const token = sp.token
  if (token) {
    const cookieStore = await cookies()
    cookieStore.set(ENTITLEMENT_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: ENTITLEMENT_TOKEN_TTL_MS / 1000,
      path: '/',
    })
    const ent = await resolveEntitlements(token)
    // B-NBT-10: this is the only moment where an anonymous device id and
    // a real email are known together — link them so the admin Users
    // view can show a real lastSeen.
    if (ent.premium || ent.stations) {
      const email = await findEmailByToken(token)
      const anonId = cookieStore.get('wthr_anon')?.value
      if (email && anonId) {
        await linkVisitorIdentity(anonId, email)
      }
    }
    return (
      <div className="max-w-md mx-auto px-4 py-10 space-y-4 text-center">
        <div className="text-4xl">✅</div>
        <h1 className="text-xl font-semibold">Suscripción activada</h1>
        <p className="text-sm text-text-tertiary">
          {ent.premium ? 'Premium' : ''} {ent.premium && ent.stations ? '+' : ''} {ent.stations ? 'Estaciones' : ''} ahora activos en este dispositivo.
        </p>
        <Link href="/" className="inline-block px-4 py-2 rounded bg-accent text-white text-sm">
          Volver a la app
        </Link>
      </div>
    )
  }
  return (
    <div className="max-w-md mx-auto px-4 py-10 space-y-4 text-center">
      <h1 className="text-xl font-semibold">Reclamar suscripción</h1>
      <p className="text-sm text-text-tertiary">
        Usa el enlace que te hemos enviado por email para activar tu suscripción en este dispositivo.
      </p>
      <p className="text-xs text-text-tertiary mt-4">
        ¿Aún no tienes suscripción? <Link href="/premium" className="text-accent hover:underline">Ver planes</Link>.
      </p>
    </div>
  )
}
