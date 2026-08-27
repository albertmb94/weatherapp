/** Canonical public origin of the app.
 *
 *  Server-side redirect targets (Stripe success/cancel URLs, emails,
 *  magic links) must NEVER be derived from the client-controlled
 *  `Origin` header — an attacker could craft post-payment redirects.
 *  This helper prefers the configured env URL and falls back to the
 *  request's own origin (trusted, comes from the routing layer).
 *
 *  AUDITORÍA: antes sólo miraba `NEXT_PUBLIC_APP_URL` / `APP_URL`. Sin
 *  ninguna de las dos devolvía cadena vacía, y eso hacía que
 *  `app/sitemap.ts` generase un sitemap VACÍO y `app/robots.ts` omitiera
 *  la línea `Sitemap:` — en silencio, sin ningún aviso. En Vercel el
 *  dominio de producción está siempre disponible como variable de
 *  entorno, así que usarlo evita depender de que alguien se acuerde de
 *  configurar la URL.
 */

function normalize(value: string | undefined): string | null {
  const v = value?.trim()
  if (!v) return null
  const withScheme = /^https?:\/\//i.test(v) ? v : `https://${v}`
  return withScheme.replace(/\/+$/, '')
}

let avisado = false

export function appOrigin(requestOrigin?: string): string {
  const configured =
    normalize(process.env.NEXT_PUBLIC_APP_URL) ?? normalize(process.env.APP_URL)
  if (configured) return configured

  // Vercel: dominio estable de producción del proyecto (sin esquema).
  const vercelProd = normalize(process.env.VERCEL_PROJECT_PRODUCTION_URL)
  if (vercelProd) return vercelProd

  const fromRequest = normalize(requestOrigin)
  if (fromRequest) return fromRequest

  // Ni configuración, ni entorno, ni petición: quien llame decidirá qué
  // hacer, pero que quede constancia una vez por proceso.
  if (!avisado && process.env.NODE_ENV === 'production') {
    avisado = true
    console.warn(
      '[appUrl] Sin origen canónico: define NEXT_PUBLIC_APP_URL. ' +
        'El sitemap se generará vacío y los enlaces absolutos de los emails no funcionarán.',
    )
  }
  return ''
}
