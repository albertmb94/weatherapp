'use client'

import { useSyncExternalStore, useState } from 'react'
import { useLocale } from '@/lib/LocaleContext'
import {
  persistConsent,
  readConsentFromBrowser,
  type ConsentValue,
} from '@/lib/trackingConsent'

/**
 * Centro de preferencias de consentimiento.
 *
 * AUDITORÍA: el consentimiento no se podía retirar. `ConsentBanner` se
 * cierra al elegir y nunca vuelve a montarse (`answeredInSession` + la
 * comprobación de localStorage), y no existía ningún otro control —
 * pese a que /cookies afirma, en los dos idiomas, que hay un "botón
 * flotante Configurar cookies en la esquina inferior derecha". Ese botón
 * nunca existió.
 *
 * El RGPD exige que retirar el consentimiento sea tan fácil como darlo,
 * así que la promesa de la política era además un problema legal. Este
 * componente vive en la propia página de política, que es donde alguien
 * va a buscarlo.
 */

const emptySubscribe = () => () => {}

export default function ConsentPreferences() {
  const { locale } = useLocale()
  const es = locale === 'es'
  const [justSaved, setJustSaved] = useState<ConsentValue | null>(null)

  // Devuelve null en SSR: el estado real sólo se conoce en el cliente.
  const stored = useSyncExternalStore(
    emptySubscribe,
    readConsentFromBrowser,
    () => null,
  )
  const current = justSaved ?? stored

  function choose(value: ConsentValue) {
    persistConsent(value)
    setJustSaved(value)
  }

  const estado =
    current === 'granted'
      ? es
        ? 'Has aceptado las cookies analíticas.'
        : 'You have accepted analytics cookies.'
      : current === 'rejected'
        ? es
          ? 'Has rechazado las cookies analíticas. No se registra ninguna visita.'
          : 'You have declined analytics cookies. No visits are recorded.'
        : es
          ? 'Todavía no has elegido. Por defecto no se registra ninguna visita.'
          : 'You have not chosen yet. By default no visits are recorded.'

  return (
    <section
      id="preferencias"
      className="rounded-2xl border border-border bg-surface-raised p-4 space-y-3 scroll-mt-8"
    >
      <h2 className="text-lg font-semibold">
        {es ? 'Tus preferencias' : 'Your preferences'}
      </h2>
      <p className="text-sm text-text-secondary">{estado}</p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => choose('granted')}
          aria-pressed={current === 'granted'}
          className={
            current === 'granted'
              ? 'px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-medium'
              : 'px-3 py-1.5 rounded-lg border border-border text-xs hover:bg-surface-popover'
          }
        >
          {es ? 'Aceptar analítica' : 'Accept analytics'}
        </button>
        <button
          type="button"
          onClick={() => choose('rejected')}
          aria-pressed={current === 'rejected'}
          className={
            current === 'rejected'
              ? 'px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-medium'
              : 'px-3 py-1.5 rounded-lg border border-border text-xs hover:bg-surface-popover'
          }
        >
          {es ? 'Rechazar analítica' : 'Decline analytics'}
        </button>
      </div>
      {justSaved ? (
        <p className="text-xs text-text-tertiary" role="status">
          {es
            ? 'Guardado. Se aplica a partir de tu próxima navegación.'
            : 'Saved. It applies from your next navigation.'}
        </p>
      ) : null}
      <p className="text-[11px] text-text-muted">
        {es
          ? 'Las cookies necesarias (tema, idioma, ciudades guardadas) no se pueden desactivar: sin ellas la aplicación no funciona, y no sirven para seguirte.'
          : 'Strictly necessary cookies (theme, locale, saved cities) cannot be disabled: the app does not work without them, and they are not used to track you.'}
      </p>
    </section>
  )
}
