import LocaleLink from '@/components/LocaleLink'
import { resolveEntitlements } from '@/lib/entitlements'
import { DEFAULT_LOCALE, isLocale } from '@/lib/locale/routing'
import type { Locale } from '@/lib/i18n'

// `noindex`: la URL lleva un token de activación. Ni canonical ni
// hreflang; sólo el título de la pestaña, en el idioma de la ruta.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  return {
    title: locale === 'en' ? 'Activate subscription' : 'Activar suscripción',
    robots: { index: false },
  }
}

/**
 * Textos de la página.
 *
 * AUDITORÍA: iba en español entera. Es el último paso de la compra —se
 * llega desde el email que manda el webhook de Stripe— así que alguien
 * que ya ha PAGADO en inglés se encontraba aquí sin entender qué botón
 * pulsar para activar lo que acaba de comprar.
 */
const UI: Record<
  Locale,
  {
    enlaceInvalido: string
    activaH1: string
    activaIntro: string
    activaBoton: string
    invalidoH1: string
    invalidoIntro: string
    contactar: string
    reclamarH1: string
    reclamarIntro: string
    sinSuscripcion: string
    verPlanes: string
  }
> = {
  es: {
    enlaceInvalido: 'El enlace no es válido o ha caducado.',
    activaH1: 'Activa tu suscripción',
    activaIntro:
      'Pulsa para activar Premium en este dispositivo. La activación se guarda en una cookie propia de este navegador.',
    activaBoton: 'Activar en este dispositivo',
    invalidoH1: 'Enlace no válido',
    invalidoIntro:
      'Este enlace de activación no corresponde a ninguna suscripción activa. Comprueba el email o contacta con soporte.',
    contactar: 'Contactar soporte',
    reclamarH1: 'Reclamar suscripción',
    reclamarIntro:
      'Usa el enlace que te hemos enviado por email para activar tu suscripción en este dispositivo.',
    sinSuscripcion: '¿Aún no tienes suscripción?',
    verPlanes: 'Ver planes',
  },
  en: {
    enlaceInvalido: 'This link is not valid or has expired.',
    activaH1: 'Activate your subscription',
    activaIntro:
      'Tap to activate Premium on this device. The activation is stored in a cookie belonging to this browser.',
    activaBoton: 'Activate on this device',
    invalidoH1: 'Invalid link',
    invalidoIntro:
      'This activation link does not match any active subscription. Check the email or contact support.',
    contactar: 'Contact support',
    reclamarH1: 'Claim subscription',
    reclamarIntro: 'Use the link we emailed you to activate your subscription on this device.',
    sinSuscripcion: 'No subscription yet?',
    verPlanes: 'See plans',
  },
}

/**
 * Página pública de claim. El webhook de Stripe envía por email un link
 * a /premium/claim?token=…; la página valida el token (solo lectura) y
 * renderiza un formulario nativo que hace POST a /api/premium/claim,
 * donde sí se puede escribir la cookie (Next 16 prohibe setear cookies
 * durante el render de un Server Component).
 */
export default async function PremiumClaimPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ token?: string; error?: string }>
}) {
  const { locale: raw } = await params
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE
  const t = UI[locale]

  const sp = await searchParams
  const token = sp.token?.trim() ?? ''

  let valid = false
  if (/^[0-9a-f]{16,64}$/i.test(token)) {
    const ent = await resolveEntitlements(token)
    valid = ent.hasAny
  }

  return (
    <div className="max-w-md mx-auto px-4 py-10 space-y-4 text-center">
      {sp.error === 'invalid' && (
        <p role="alert" className="text-sm text-red-400">
          {t.enlaceInvalido}
        </p>
      )}

      {token && valid ? (
        <>
          <div className="text-4xl">✅</div>
          <h1 className="text-xl font-semibold">{t.activaH1}</h1>
          <p className="text-sm text-text-tertiary">{t.activaIntro}</p>
          {/* method=post nativo: funciona incluso sin JS */}
          <form action="/api/premium/claim" method="post">
            <input type="hidden" name="token" value={token} />
            <button
              type="submit"
              className="inline-block px-4 py-2 rounded bg-accent text-white text-sm font-medium hover:bg-accent/90 transition-colors"
            >
              {t.activaBoton}
            </button>
          </form>
        </>
      ) : token ? (
        <>
          <div className="text-4xl">⚠️</div>
          <h1 className="text-xl font-semibold">{t.invalidoH1}</h1>
          <p className="text-sm text-text-tertiary">{t.invalidoIntro}</p>
          <LocaleLink href="/support" className="inline-block px-4 py-2 rounded border border-border text-sm">
            {t.contactar}
          </LocaleLink>
        </>
      ) : (
        <>
          <h1 className="text-xl font-semibold">{t.reclamarH1}</h1>
          <p className="text-sm text-text-tertiary">{t.reclamarIntro}</p>
          <p className="text-xs text-text-tertiary mt-4">
            {t.sinSuscripcion}{' '}
            <LocaleLink href="/premium" className="text-accent hover:underline">
              {t.verPlanes}
            </LocaleLink>
            .
          </p>
        </>
      )}
    </div>
  )
}
