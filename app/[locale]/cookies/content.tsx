'use client'

import { useLocale } from '@/lib/LocaleContext'
import ConsentPreferences from '@/components/ConsentPreferences'

export default function CookiesContent() {
  const { locale } = useLocale()
  const es = locale === 'es'
  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      <h1 className="text-2xl font-semibold">{es ? 'Política de cookies' : 'Cookie policy'}</h1>
      <p className="text-xs text-text-tertiary">Última actualización: 2026-08-27</p>
      {/* AUDITORIA: esta pagina prometia (en los dos idiomas) un "boton
          flotante Configurar cookies en la esquina inferior derecha" que
          NUNCA existio: el banner se cierra al elegir y no vuelve a
          montarse, asi que no habia forma de retirar el consentimiento.
          El RGPD exige que retirarlo sea tan facil como darlo. */}
      <ConsentPreferences />
      {es ? <Es /> : <En />}
    </div>
  )
}

function Es() {
  return (
    <article className="space-y-4 text-sm">
      <p>Usamos cookies para mejorar la experiencia y medir el uso agregado. Puedes cambiar tu elección cuando quieras en <a href="#preferencias" className="text-accent hover:underline">Tus preferencias</a>, al principio de esta página. Sin tu consentimiento explícito no se generan cookies de analítica ni se registran visitas.</p>
      <h2 className="text-lg font-semibold mt-6">Tipos de cookies</h2>
      <ul className="list-disc pl-6 space-y-2">
        <li><strong>Necesarias:</strong> identificador anónimo de sesión, tema, idioma, preferencias de ciudad. No requieren consentimiento.</li>
        <li><strong>Analíticas:</strong> analítica propia de primer orden (ID anónimo + sesión) y, opcionalmente, Plausible Analytics. Datos anónimos agregados.</li>
        <li><strong>Publicidad:</strong> Google AdSense. Mostrada solo con consentimiento explícito.</li>
        <li><strong>Personalización:</strong> secciones patrocinadas y recomendaciones contextuales.</li>
      </ul>
      <h2 className="text-lg font-semibold mt-6">Cómo desactivar</h2>
      <p>Puedes revocar tu consentimiento en cualquier momento en <a href="#preferencias" className="text-accent hover:underline">Tus preferencias</a>, al principio de esta página. También puedes bloquear cookies en tu navegador.</p>
    </article>
  )
}

function En() {
  return (
    <article className="space-y-4 text-sm">
      <p>We use cookies to improve the experience and measure aggregate usage. You can change your choice at any time under <a href="#preferencias" className="text-accent hover:underline">Your preferences</a>, at the top of this page. Without your explicit consent no analytics cookies are set and no visits are recorded.</p>
      <h2 className="text-lg font-semibold mt-6">Cookie types</h2>
      <ul className="list-disc pl-6 space-y-2">
        <li><strong>Strictly necessary:</strong> anonymous session ID, theme, locale, saved-city preferences. No consent required.</li>
        <li><strong>Analytics:</strong> first-party analytics (anonymous ID + session) and, optionally, Plausible Analytics. Anonymous aggregate data.</li>
        <li><strong>Advertising:</strong> Google AdSense. Shown only with explicit consent.</li>
        <li><strong>Personalisation:</strong> sponsored sections and contextual recommendations.</li>
      </ul>
      <h2 className="text-lg font-semibold mt-6">How to disable</h2>
      <p>Revoke consent any time under <a href="#preferencias" className="text-accent hover:underline">Your preferences</a>, at the top of this page. You can also block cookies in your browser settings.</p>
    </article>
  )
}
