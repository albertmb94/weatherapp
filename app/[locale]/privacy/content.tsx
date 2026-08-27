'use client'

import { useLocale } from '@/lib/LocaleContext'

export default function PrivacyContent() {
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
          <li>Ciudad y coordenadas exactas que consultas (tu navegador). Cuando das consentimiento de analítica, se guarda en el servidor una <em>celda geográfica aproximada</em> (~1 km) derivada de esas coordenadas, para el desglose por zonas del panel.</li>
          <li>Un identificador anónimo aleatorio (cookie) para atribuir clics y medir uso agregado, y una cookie de sesión.</li>
          <li>Si te suscribes a algún servicio de pago: email y datos de facturación (gestionados por Stripe), y el token de activación en este dispositivo.</li>
          <li>Si activas notificaciones push: el endpoint de tu navegador y claves públicas (gestionado localmente).</li>
        </ul>
      </section>
      <section>
        <h2 className="text-lg font-semibold">3. Finalidad</h2>
        <p>Mostrar la previsión meteorológica, recordar tus preferencias, procesar suscripciones, enviar emails transaccionales y analizar uso agregado de forma anónima.</p>
      </section>
      <section>
        <h2 className="text-lg font-semibold">4. Base legal</h2>
        <p>Consentimiento (RGPD art. 6.1.a) para analítica, anuncios y newsletter (double opt-in). Puedes revocarlo en cualquier momento desde el botón &quot;Configurar cookies&quot;. Los datos de suscripción se procesan por ejecución del contrato (art. 6.1.b).</p>
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
          <li>City and exact coordinates you look up (in your browser). When you consent to analytics, an <em>approximate geo cell</em> (~1 km) derived from those coordinates is stored server-side for the dashboard&apos;s zone breakdown.</li>
          <li>A random anonymous identifier (cookie) to attribute clicks and measure aggregate usage, plus a session cookie.</li>
          <li>If you subscribe to a paid service: email and billing data (handled by Stripe), and the activation token on this device.</li>
          <li>If you opt into push notifications: your browser endpoint and public keys (stored locally).</li>
        </ul>
      </section>
      <section>
        <h2 className="text-lg font-semibold">3. Purpose</h2>
        <p>Display weather forecasts, remember your preferences, process subscriptions, send transactional emails and analyse aggregate usage anonymously.</p>
      </section>
      <section>
        <h2 className="text-lg font-semibold">4. Legal basis</h2>
        <p>Consent (GDPR art. 6.1.a) for analytics, advertising and the newsletter (double opt-in). You can revoke it at any time from the &quot;Configure cookies&quot; button. Subscription data is processed for contract performance (art. 6.1.b).</p>
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
