import LocaleLink from '@/components/LocaleLink'
import { cookies } from 'next/headers'
import { ENTITLEMENT_COOKIE_NAME, resolveEntitlements } from '@/lib/entitlements'
import { DEFAULT_LOCALE, isLocale } from '@/lib/locale/routing'
import type { Locale } from '@/lib/i18n'

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
 * Textos de la página.
 *
 * AUDITORÍA: el `title` de la pestaña YA se traducía (arriba), pero el
 * cuerpo entero estaba en español — incluidos los avisos de error del
 * portal de Stripe y el estado de la suscripción. Alguien que acaba de
 * pagar en inglés aterrizaba aquí y no podía leer si su pago había
 * salido bien.
 */
const UI: Record<
  Locale,
  {
    h1: string
    pagoOk: string
    activadoOk: string
    estado: string
    premium: string
    estaciones: string
    activo: string
    inactivo: string
    portal: string
    portalIntro: string
    abrirPortal: string
    sinSuscripcion: string
    verPlanes: string
    volver: string
    errores: Record<string, string>
  }
> = {
  es: {
    h1: 'Gestionar suscripción',
    pagoOk:
      '✅ Pago completado. Te hemos enviado un email con el enlace para activar la suscripción en otros dispositivos.',
    activadoOk: '✅ Suscripción activada en este dispositivo.',
    estado: 'Estado actual',
    premium: 'Premium',
    estaciones: 'Estaciones (add-on)',
    activo: 'Activo',
    inactivo: 'Inactivo',
    portal: 'Portal de cliente (Stripe)',
    portalIntro:
      'Cambia el método de pago, actualiza la tarjeta o cancela la suscripción desde el portal seguro de Stripe.',
    abrirPortal: 'Abrir portal de Stripe',
    sinSuscripcion:
      'No tienes ninguna suscripción activa en este dispositivo. El portal de Stripe está disponible solo para usuarios con suscripción.',
    verPlanes: 'Ver planes',
    volver: '← App',
    errores: {
      disabled: 'El portal de cliente está desactivado.',
      not_configured: 'El portal de cliente no está configurado todavía.',
      no_subscription: 'No encontramos una suscripción de Stripe asociada a este dispositivo.',
      no_customer: 'No encontramos una suscripción de Stripe asociada a este dispositivo.',
      error: 'No se pudo abrir el portal de Stripe. Inténtalo de nuevo.',
    },
  },
  en: {
    h1: 'Manage subscription',
    pagoOk:
      '✅ Payment complete. We have emailed you a link to activate the subscription on your other devices.',
    activadoOk: '✅ Subscription activated on this device.',
    estado: 'Current status',
    premium: 'Premium',
    estaciones: 'Stations (add-on)',
    activo: 'Active',
    inactivo: 'Inactive',
    portal: 'Customer portal (Stripe)',
    portalIntro:
      'Change your payment method, update your card or cancel the subscription from Stripe’s secure portal.',
    abrirPortal: 'Open Stripe portal',
    sinSuscripcion:
      'You have no active subscription on this device. The Stripe portal is only available to subscribers.',
    verPlanes: 'See plans',
    volver: '← App',
    errores: {
      disabled: 'The customer portal is disabled.',
      not_configured: 'The customer portal is not configured yet.',
      no_subscription: 'We could not find a Stripe subscription linked to this device.',
      no_customer: 'We could not find a Stripe subscription linked to this device.',
      error: 'We could not open the Stripe portal. Please try again.',
    },
  },
}

/**
 * Manage subscriptions. The user lands here after checkout
 * (?checkout=success), after claiming a token (?claim=success), or from
 * the footer. The Stripe Customer Portal link opens a portal session
 * scoped to the entitlement holder (app/api/stripe/portal).
 */
export default async function ManagePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ checkout?: string; claim?: string; portal?: string }>
}) {
  const { locale: raw } = await params
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE
  const t = UI[locale]

  const sp = await searchParams
  const cookieStore = await cookies()
  const token = cookieStore.get(ENTITLEMENT_COOKIE_NAME)?.value
  const ent = await resolveEntitlements(token)

  // Lista blanca: `portal` viene de la URL, así que sólo se muestra un
  // mensaje si la clave es una de las nuestras. Con un `?portal=` libre
  // se podría inyectar texto arbitrario en la página.
  const portalError = sp.portal ? (t.errores[sp.portal] ?? null) : null

  return (
    <div className="max-w-2xl mx-auto px-4 py-10 space-y-6">
      <h1 className="text-2xl font-semibold">{t.h1}</h1>

      {sp.checkout === 'success' && (
        <p role="status" className="rounded-xl border border-green-500/30 bg-green-500/5 px-4 py-3 text-sm">
          {t.pagoOk}
        </p>
      )}
      {sp.claim === 'success' && (
        <p role="status" className="rounded-xl border border-green-500/30 bg-green-500/5 px-4 py-3 text-sm">
          {t.activadoOk}
        </p>
      )}
      {portalError && (
        <p role="alert" className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm">
          {portalError}
        </p>
      )}

      <section className="rounded-2xl border border-border bg-surface-raised p-5 space-y-3">
        <h2 className="text-sm font-semibold">{t.estado}</h2>
        <ul className="text-sm space-y-1">
          <li>
            {t.premium}: <strong>{ent.premium ? t.activo : t.inactivo}</strong>
          </li>
          <li>
            {t.estaciones}: <strong>{ent.stations ? t.activo : t.inactivo}</strong>
          </li>
        </ul>
      </section>

      {ent.hasAny ? (
        <section className="rounded-2xl border border-border bg-surface-raised p-5 space-y-3">
          <h2 className="text-sm font-semibold">{t.portal}</h2>
          <p className="text-xs text-text-tertiary">{t.portalIntro}</p>
          {/* `<a>` deliberado: /api/stripe/portal es un route handler que
              redirige al portal de Stripe, no una página de la app.
              `<Link>` haría una navegación de cliente contra algo que no
              devuelve un payload RSC. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a
            href="/api/stripe/portal"
            className="inline-block px-4 py-2 rounded bg-accent text-white text-sm font-medium hover:bg-accent/90 transition-colors"
          >
            {t.abrirPortal}
          </a>
        </section>
      ) : (
        <section className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
          <p>{t.sinSuscripcion}</p>
        </section>
      )}

      <div className="flex gap-2 text-sm">
        <LocaleLink href="/premium" className="px-4 py-2 rounded border border-border">
          {t.verPlanes}
        </LocaleLink>
        <LocaleLink href="/" className="px-4 py-2 rounded border border-border">
          {t.volver}
        </LocaleLink>
      </div>
    </div>
  )
}
