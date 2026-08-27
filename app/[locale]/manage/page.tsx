import LocaleLink from '@/components/LocaleLink'
import { cookies } from 'next/headers'
import { ENTITLEMENT_COOKIE_NAME, resolveEntitlements } from '@/lib/entitlements'

// `noindex` a propósito: la página depende de una cookie de permiso y no
// aporta nada a un buscador. Por eso NO lleva canonical ni hreflang: sólo
// el título, que sí ve la persona en la pestaña del navegador.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  return {
    title: locale === 'en' ? 'Manage subscription' : 'Gestionar suscripción',
    robots: { index: false },
  }
}

/**
 * Manage subscriptions. The user lands here after checkout
 * (?checkout=success), after claiming a token (?claim=success), or from
 * the footer. The Stripe Customer Portal link opens a portal session
 * scoped to the entitlement holder (app/api/stripe/portal).
 */
export default async function ManagePage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string; claim?: string; portal?: string }>
}) {
  const sp = await searchParams
  const cookieStore = await cookies()
  const token = cookieStore.get(ENTITLEMENT_COOKIE_NAME)?.value
  const ent = await resolveEntitlements(token)

  const portalError =
    sp.portal === 'disabled'
      ? 'El portal de cliente está desactivado.'
      : sp.portal === 'not_configured'
        ? 'El portal de cliente no está configurado todavía.'
        : sp.portal === 'no_subscription' || sp.portal === 'no_customer'
          ? 'No encontramos una suscripción de Stripe asociada a este dispositivo.'
          : sp.portal === 'error'
            ? 'No se pudo abrir el portal de Stripe. Inténtalo de nuevo.'
            : null

  return (
    <div className="max-w-2xl mx-auto px-4 py-10 space-y-6">
      <h1 className="text-2xl font-semibold">Gestionar suscripción</h1>

      {sp.checkout === 'success' && (
        <p role="status" className="rounded-xl border border-green-500/30 bg-green-500/5 px-4 py-3 text-sm">
          ✅ Pago completado. Te hemos enviado un email con el enlace para
          activar la suscripción en otros dispositivos.
        </p>
      )}
      {sp.claim === 'success' && (
        <p role="status" className="rounded-xl border border-green-500/30 bg-green-500/5 px-4 py-3 text-sm">
          ✅ Suscripción activada en este dispositivo.
        </p>
      )}
      {portalError && (
        <p role="alert" className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm">
          {portalError}
        </p>
      )}

      <section className="rounded-2xl border border-border bg-surface-raised p-5 space-y-3">
        <h2 className="text-sm font-semibold">Estado actual</h2>
        <ul className="text-sm space-y-1">
          <li>Premium: <strong>{ent.premium ? 'Activo' : 'Inactivo'}</strong></li>
          <li>Estaciones (add-on): <strong>{ent.stations ? 'Activo' : 'Inactivo'}</strong></li>
        </ul>
      </section>

      {ent.hasAny ? (
        <section className="rounded-2xl border border-border bg-surface-raised p-5 space-y-3">
          <h2 className="text-sm font-semibold">Portal de cliente (Stripe)</h2>
          <p className="text-xs text-text-tertiary">
            Cambia el método de pago, actualiza la tarjeta o cancela la
            suscripción desde el portal seguro de Stripe.
          </p>
          {/* `<a>` deliberado: /api/stripe/portal es un route handler que
              redirige al portal de Stripe, no una página de la app.
              `<Link>` haría una navegación de cliente contra algo que no
              devuelve un payload RSC. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a
            href="/api/stripe/portal"
            className="inline-block px-4 py-2 rounded bg-accent text-white text-sm font-medium hover:bg-accent/90 transition-colors"
          >
            Abrir portal de Stripe
          </a>
        </section>
      ) : (
        <section className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
          <p>
            No tienes ninguna suscripción activa en este dispositivo. El portal
            de Stripe está disponible solo para usuarios con suscripción.
          </p>
        </section>
      )}

      <div className="flex gap-2 text-sm">
        <LocaleLink href="/premium" className="px-4 py-2 rounded border border-border">Ver planes</LocaleLink>
        <LocaleLink href="/" className="px-4 py-2 rounded border border-border">← App</LocaleLink>
      </div>
    </div>
  )
}
