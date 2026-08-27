'use client'

import { useLocale } from '@/lib/LocaleContext'

export default function CookiesPage() {
  const { locale } = useLocale()
  const es = locale === 'es'
  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      <h1 className="text-2xl font-semibold">{es ? 'Política de cookies' : 'Cookie policy'}</h1>
      <p className="text-xs text-text-tertiary">Última actualización: 2026-08-06</p>
      {es ? <Es /> : <En />}
    </div>
  )
}

function Es() {
  return (
    <article className="space-y-4 text-sm">
      <p>Usamos cookies para mejorar la experiencia y medir el uso agregado. Puedes configurar tu consentimiento desde el botón flotante &quot;Configurar cookies&quot;.</p>
      <h2 className="text-lg font-semibold mt-6">Tipos de cookies</h2>
      <ul className="list-disc pl-6 space-y-2">
        <li><strong>Necesarias:</strong> identificador anónimo de sesión, tema, idioma. No requieren consentimiento.</li>
        <li><strong>Analíticas:</strong> Plausible Analytics (autoalojado o cloud). Datos anónimos agregados.</li>
        <li><strong>Publicidad:</strong> Google AdSense, EthicalAds. Mostradas solo con consentimiento explícito.</li>
        <li><strong>Personalización:</strong> secciones patrocinadas y recomendaciones contextuales.</li>
      </ul>
      <h2 className="text-lg font-semibold mt-6">Cómo desactivar</h2>
      <p>Puedes revocar tu consentimiento en cualquier momento desde el botón &quot;Configurar cookies&quot; en la esquina inferior derecha de la pantalla. También puedes bloquear cookies en tu navegador.</p>
    </article>
  )
}

function En() {
  return (
    <article className="space-y-4 text-sm">
      <p>We use cookies to improve the experience and measure aggregate usage. You can manage consent from the floating &quot;Configure cookies&quot; button.</p>
      <h2 className="text-lg font-semibold mt-6">Cookie types</h2>
      <ul className="list-disc pl-6 space-y-2">
        <li><strong>Strictly necessary:</strong> anonymous session ID, theme, locale. No consent required.</li>
        <li><strong>Analytics:</strong> Plausible Analytics. Anonymous aggregate data.</li>
        <li><strong>Advertising:</strong> Google AdSense, EthicalAds. Shown only with explicit consent.</li>
        <li><strong>Personalisation:</strong> sponsored sections and contextual recommendations.</li>
      </ul>
      <h2 className="text-lg font-semibold mt-6">How to disable</h2>
      <p>Revoke consent any time from the &quot;Configure cookies&quot; button (bottom-right). You can also block cookies in your browser settings.</p>
    </article>
  )
}
