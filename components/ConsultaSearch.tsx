'use client'

import { useId, useRef, useState } from 'react'
import { useLocale } from '@/lib/LocaleContext'
import { fetchWithTimeout } from '@/lib/fetchWithTimeout'
import type { ConsultaParams } from '@/lib/consulta'
import { consultaParamsToUrlPatch, franjaToLocalHour, type ConsultaUrlPatch } from '@/lib/consultaUi'

/** A known place, so Jev can *select* it instead of inventing one. */
export interface ConsultaCandidato {
  id: string
  nombre: string
  lat: number
  lon: number
}

export interface ConsultaApply {
  patch: ConsultaUrlPatch
  lugar: { nombre: string; lat: number; lon: number } | null
  /** Target local hour derived from `franja`, or null when unspecified. */
  localHour: number | null
}

interface ConsultaSearchProps {
  candidatos: ConsultaCandidato[]
  onApply: (apply: ConsultaApply) => void
}

const STRINGS = {
  es: {
    placeholder: 'Pregunta: "¿va a llover mañana en Girona?"',
    label: 'Consulta en lenguaje natural',
    submit: 'Aplicar',
    noConfig: 'Consulta no disponible (TypeSafe sin configurar).',
    noMeteo: 'Eso no parece una consulta del tiempo.',
    error: 'No se pudo interpretar la consulta.',
    ok: 'Aplicado.',
  },
  en: {
    placeholder: 'Ask: "will it rain tomorrow in Girona?"',
    label: 'Natural-language query',
    submit: 'Apply',
    noConfig: 'Query unavailable (TypeSafe not configured).',
    noMeteo: 'That does not look like a weather question.',
    error: 'Could not interpret the query.',
    ok: 'Applied.',
  },
} as const

/**
 * Natural-language command box. Sends the free text to `/api/consulta`
 * (Jev / TypeSafe) and hands the typed result to the parent, which owns
 * the URL state and the forecast series. Never imports the SDK or the
 * API key — this is a client component.
 */
export default function ConsultaSearch({ candidatos, onApply }: ConsultaSearchProps) {
  const { locale } = useLocale()
  const t = STRINGS[locale === 'en' ? 'en' : 'es']
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    const q = query.trim()
    if (q.length < 3 || busy) return

    setBusy(true)
    setMessage(null)
    try {
      const res = await fetchWithTimeout('/api/consulta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Only id + name go over the wire; coordinates stay on the client.
        body: JSON.stringify({
          q,
          locale: locale === 'en' ? 'en' : 'es',
          candidatos: candidatos.map(({ id, nombre }) => ({ id, nombre })),
        }),
        timeoutMs: 20_000,
      })

      if (res.status === 503) {
        setMessage(t.noConfig)
        return
      }
      if (!res.ok) {
        setMessage(t.error)
        return
      }

      const data = (await res.json()) as { params: ConsultaParams }
      const parsed = data.params
      if (!parsed.esConsultaMeteo) {
        setMessage(t.noMeteo)
        return
      }

      const match = parsed.lugar
        ? candidatos.find((c) => c.id === parsed.lugar!.id) ?? null
        : null

      onApply({
        patch: consultaParamsToUrlPatch(parsed),
        lugar: match ? { nombre: match.nombre, lat: match.lat, lon: match.lon } : null,
        localHour: franjaToLocalHour(parsed.franja),
      })
      setMessage(t.ok)
    } catch {
      setMessage(t.error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="w-full">
      <label htmlFor={inputId} className="sr-only">
        {t.label}
      </label>
      <div className="relative w-full">
        <input
          ref={inputRef}
          id={inputId}
          data-consulta-search-input=""
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t.placeholder}
          autoComplete="off"
          className="w-full min-w-0 pl-3 pr-20 py-2 bg-surface-popover text-text-primary text-sm rounded-lg placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent/40 border border-border transition-colors"
        />
        <button
          type="submit"
          disabled={busy || query.trim().length < 3}
          className="absolute right-1 top-1/2 -translate-y-1/2 px-3 py-1 rounded-md text-xs font-medium bg-accent text-white hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {busy ? (
            <span className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
          ) : (
            t.submit
          )}
        </button>
      </div>
      {message && (
        <p aria-live="polite" className="mt-1 text-xs text-text-tertiary">
          {message}
        </p>
      )}
    </form>
  )
}
