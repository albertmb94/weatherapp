'use client'

import { useLocale } from '@/lib/LocaleContext'

export default function TermsContent() {
  const { locale } = useLocale()
  const es = locale === 'es'
  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      <h1 className="text-2xl font-semibold">{es ? 'Términos de servicio' : 'Terms of service'}</h1>
      <p className="text-xs text-text-tertiary">Última actualización: 2026-08-06</p>
      {es ? <Es /> : <En />}
    </div>
  )
}

function Es() {
  return (
    <article className="space-y-4 text-sm">
      <p>Weather App proporciona información meteorológica con fines informativos. <strong>No garantizamos la precisión de las predicciones</strong> y no nos hacemos responsables de decisiones tomadas en base a la información mostrada.</p>
      <h2 className="text-lg font-semibold mt-6">Suscripciones</h2>
      <p>Las suscripciones se procesan a través de Stripe. Al contratar recibirás un email con el enlace para activar la suscripción en tus dispositivos. Puedes cancelar o cambiar el método de pago en cualquier momento desde <em>Gestionar suscripción</em> (/manage → Portal de Stripe). Las cancelaciones surten efecto al final del período de facturación en curso.</p>
      <h2 className="text-lg font-semibold mt-6">Reembolsos</h2>
      <p>Ofrecemos reembolso completo durante los primeros 14 días desde la compra. Para solicitarlo, contacta por email.</p>
      <h2 className="text-lg font-semibold mt-6">Limitación de responsabilidad</h2>
      <p>La aplicación se proporciona &quot;tal cual&quot;. No somos responsables de daños directos, indirectos o consecuenciales derivados del uso de la información meteorológica.</p>
    </article>
  )
}

function En() {
  return (
    <article className="space-y-4 text-sm">
      <p>Weather App provides meteorological information for informational purposes. <strong>We do not guarantee forecast accuracy</strong> and are not liable for decisions made based on the information displayed.</p>
      <h2 className="text-lg font-semibold mt-6">Subscriptions</h2>
      <p>Subscriptions are processed through Stripe. On signup you receive an email with the link to activate your subscription on your devices. You can cancel or update your payment method at any time from <em>Manage subscription</em> (/manage → Stripe portal). Cancellations take effect at the end of the current billing period.</p>
      <h2 className="text-lg font-semibold mt-6">Refunds</h2>
      <p>We offer a full refund within the first 14 days of purchase. Contact by email to request one.</p>
      <h2 className="text-lg font-semibold mt-6">Limitation of liability</h2>
      <p>The application is provided &quot;as is&quot;. We are not liable for direct, indirect or consequential damages arising from the use of weather information.</p>
    </article>
  )
}
