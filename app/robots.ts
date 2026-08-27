import type { MetadataRoute } from 'next'
import { appOrigin } from '@/lib/appUrl'

/**
 * robots.txt.
 *
 * No existía ninguno — ni este fichero, ni `public/robots.txt`. Sin él,
 * los rastreadores indexan por defecto todo lo que alcanzan, incluidas
 * rutas que no aportan nada al buscador (el panel de administración, las
 * de reclamación de suscripción) y no encuentran el sitemap.
 */
export default function robots(): MetadataRoute.Robots {
  const origin = appOrigin()
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/admin',
          '/admin/',
          '/api/',
          // Llevan un token en la URL: no deben acabar en un índice.
          '/premium/claim',
          '/manage',
          // Enlaces cortos: son redirecciones, no contenido.
          '/s/',
        ],
      },
    ],
    // Sin NEXT_PUBLIC_APP_URL configurada no se anuncia un sitemap con
    // host equivocado: mejor omitirlo que apuntar a ninguna parte.
    ...(origin ? { sitemap: `${origin}/sitemap.xml`, host: origin } : {}),
  }
}
