import LocaleLink from '@/components/LocaleLink'
import { resolveEntitlements } from '@/lib/entitlements'

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
 * Página pública de claim. El webhook de Stripe envía por email un link
 * a /premium/claim?token=…; la página valida el token (solo lectura) y
 * renderiza un formulario nativo que hace POST a /api/premium/claim,
 * donde sí se puede escribir la cookie (Next 16 prohibe setear cookies
 * durante el render de un Server Component).
 */
export default async function PremiumClaimPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>
}) {
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
          El enlace no es válido o ha caducado.
        </p>
      )}

      {token && valid ? (
        <>
          <div className="text-4xl">✅</div>
          <h1 className="text-xl font-semibold">Activa tu suscripción</h1>
          <p className="text-sm text-text-tertiary">
            Pulsa para activar Premium en este dispositivo. La activación se
            guarda en una cookie propia de este navegador.
          </p>
          {/* method=post nativo: funciona incluso sin JS */}
          <form action="/api/premium/claim" method="post">
            <input type="hidden" name="token" value={token} />
            <button
              type="submit"
              className="inline-block px-4 py-2 rounded bg-accent text-white text-sm font-medium hover:bg-accent/90 transition-colors"
            >
              Activar en este dispositivo
            </button>
          </form>
        </>
      ) : token ? (
        <>
          <div className="text-4xl">⚠️</div>
          <h1 className="text-xl font-semibold">Enlace no válido</h1>
          <p className="text-sm text-text-tertiary">
            Este enlace de activación no corresponde a ninguna suscripción
            activa. Comprueba el email o contacta con soporte.
          </p>
          <LocaleLink href="/support" className="inline-block px-4 py-2 rounded border border-border text-sm">
            Contactar soporte
          </LocaleLink>
        </>
      ) : (
        <>
          <h1 className="text-xl font-semibold">Reclamar suscripción</h1>
          <p className="text-sm text-text-tertiary">
            Usa el enlace que te hemos enviado por email para activar tu suscripción en este dispositivo.
          </p>
          <p className="text-xs text-text-tertiary mt-4">
            ¿Aún no tienes suscripción?{' '}
            <LocaleLink href="/premium" className="text-accent hover:underline">Ver planes</LocaleLink>.
          </p>
        </>
      )}
    </div>
  )
}
