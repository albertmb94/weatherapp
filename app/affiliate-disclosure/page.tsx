'use client'

import { useLocale } from '@/lib/LocaleContext'

export default function AffiliateDisclosurePage() {
  const { locale } = useLocale()
  const es = locale === 'es'
  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      <h1 className="text-2xl font-semibold">{es ? 'Divulgación de afiliados' : 'Affiliate disclosure'}</h1>
      <p className="text-xs text-text-tertiary">Última actualización: 2026-08-06</p>
      {es ? <Es /> : <En />}
    </div>
  )
}

function Es() {
  return (
    <article className="space-y-4 text-sm">
      <p>Algunas secciones de la app muestran productos recomendados (protección solar cuando el UV es alto, paraguas cuando se espera lluvia, etc.). Estos productos son enlaces de afiliado.</p>
      <p><strong>Como asociado de Amazon, gano comisiones por compras elegibles.</strong> El precio que pagas no cambia.</p>
      <p>Los productos se seleccionan en función del contexto meteorológico y pueden no ser óptimos para tu caso particular. Las recomendaciones son orientativas y no constituyen consejo profesional.</p>
      <p>Weather App es participante del programa de Amazon Services LLC Associates, un programa de publicidad de afiliados diseñado para que sitios web ganen comisiones por enlazar a amazon.es y sitios asociados.</p>
    </article>
  )
}

function En() {
  return (
    <article className="space-y-4 text-sm">
      <p>Some sections of the app show recommended products (sunscreen when UV is high, umbrella when rain is expected, etc.). These products are affiliate links.</p>
      <p><strong>As an Amazon Associate I earn from qualifying purchases.</strong> The price you pay does not change.</p>
      <p>Products are selected based on weather context and may not be optimal for your specific situation. Recommendations are indicative and do not constitute professional advice.</p>
      <p>Weather App is a participant in the Amazon Services LLC Associates Program, an affiliate advertising program designed to provide a means for sites to earn fees by linking to amazon.es and affiliated sites.</p>
    </article>
  )
}
