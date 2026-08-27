'use client'

import { useLocale } from '@/lib/LocaleContext'

export default function PrivacyPage() {
  const { locale } = useLocale()
  const es = locale === 'es'
  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">{es ? 'Política de privacidad' : 'Privacy policy'}</h1>
        <p className="text-xs text-text-tertiary mt-1">{es ? 'Última actualización' : 'Last updated'}: 2026-08-06</p>
      </header>
      {es ? <Es /> : <En />}
    </div>
  )
}

function Es() {
  return (
    <article className="prose prose-sm dark:prose-invert space-y-4 text-sm">
      <section>
        <h2 className="text-lg font-semibold">1. Responsable del tratamiento</h2>
        <p>Weather App es un proyecto personal. Para cualquier consulta sobre privacidad, contacta a través del repositorio público del proyecto.</p>
      </section>
      <section>
        <h2 className="text-lg font-semibold">2. Datos que recopilamos</h2>
        <ul className="list-disc pl-6 space-y-1">
          <li>Ciudad y coordenadas que consultas (almacenadas solo en tu navegador).</li>
          <li>Un identificador anónimo aleatorio (cookie) para atribuir clics y medir uso agregado.</li>
          <li>Si te suscribes a algún servicio de pago: email y datos de facturación (gestionados por Stripe).</li>
          <li>Si activas notificaciones push: el endpoint de tu navegador y claves públicas (gestionado localmente).</li>
        </ul>
      </section>
      <section>
        <h2 className="text-lg font-semibold">3. Finalidad</h2>
        <p>Mostrar la previsión meteorológica, recordar tus preferencias, procesar suscripciones, enviar emails transaccionales y analizar uso agregado de forma anónima.</p>
      </section>
      <section>
        <h2 className="text-lg font-semibold">4. Base legal</h2>
        <p>Consentimiento (RGPD art. 6.1.a). Puedes revocarlo en cualquier momento desde el botón &quot;Configurar cookies&quot;.</p>
      </section>
      <section>
        <h2 className="text-lg font-semibold">5. Conservación</h2>
        <p>Los datos anónimos agregados se conservan hasta 90 días. Los datos de suscripción se conservan mientras mantengas la suscripción activa.</p>
      </section>
      <section>
        <h2 className="text-lg font-semibold">6. Tus derechos</h2>
        <p>Acceso, rectificación, supresión, oposición, portabilidad. Para ejercerlos, contacta por email.</p>
      </section>
    </article>
  )
}

function En() {
  return (
    <article className="prose prose-sm dark:prose-invert space-y-4 text-sm">
      <section>
        <h2 className="text-lg font-semibold">1. Data controller</h2>
        <p>Weather App is a personal project. For any privacy-related request, reach out through the project&apos;s public repository.</p>
      </section>
      <section>
        <h2 className="text-lg font-semibold">2. Data we collect</h2>
        <ul className="list-disc pl-6 space-y-1">
          <li>City and coordinates you look up (stored only in your browser).</li>
          <li>A random anonymous identifier (cookie) to attribute clicks and measure aggregate usage.</li>
          <li>If you subscribe to a paid service: email and billing data (handled by Stripe).</li>
          <li>If you opt into push notifications: your browser endpoint and public keys (stored locally).</li>
        </ul>
      </section>
      <section>
        <h2 className="text-lg font-semibold">3. Purpose</h2>
        <p>Display weather forecasts, remember your preferences, process subscriptions, send transactional emails and analyse aggregate usage anonymously.</p>
      </section>
      <section>
        <h2 className="text-lg font-semibold">4. Legal basis</h2>
        <p>Consent (GDPR art. 6.1.a). You can revoke it at any time from the &quot;Configure cookies&quot; button.</p>
      </section>
      <section>
        <h2 className="text-lg font-semibold">5. Retention</h2>
        <p>Aggregate anonymous data is kept for up to 90 days. Subscription data is kept while your subscription is active.</p>
      </section>
      <section>
        <h2 className="text-lg font-semibold">6. Your rights</h2>
        <p>Access, rectification, erasure, objection, portability. To exercise them, contact by email.</p>
      </section>
    </article>
  )
}
