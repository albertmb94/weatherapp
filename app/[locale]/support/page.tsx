import type { Metadata } from 'next'
import { getFeature } from '@/lib/features'
import SupportButton from '@/components/SupportButton'
import { makeGenerateMetadata } from '@/lib/locale/pageMeta'

const COPY = {
  title: { es: 'Soporte', en: 'Support' },
  description: {
    es: 'Ayuda, contacto y formas de apoyar el proyecto.',
    en: 'Help, contact and ways to support the project.',
  },
}

export const generateMetadata: (args: {
  params: Promise<{ locale: string }>
}) => Promise<Metadata> = makeGenerateMetadata('/support', COPY)

export default async function SupportPage() {
  const kofi = await getFeature('feature.kofi')
  const sponsors = await getFeature('feature.githubsponsors')
  const kofiUrl = typeof kofi.config.url === 'string' ? kofi.config.url : null
  const sponsorsUrl = typeof sponsors.config.url === 'string' ? sponsors.config.url : null

  return (
    <div className="max-w-2xl mx-auto px-4 py-10 space-y-6">
      <h1 className="text-2xl font-semibold">Apoya el proyecto</h1>
      <p className="text-sm text-text-tertiary">
        Weather es un proyecto personal. Si te resulta útil, considera apoyar su desarrollo.
      </p>

      {!kofi.enabled && !sponsors.enabled && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
          <p className="text-sm">
            Las donaciones están desactivadas por ahora. Activa la feature correspondiente en /admin/features.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {kofi.enabled && kofiUrl ? (
          <a
            href={kofiUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-2xl border border-pink-500/30 bg-pink-500/5 p-5 hover:bg-pink-500/10 transition-colors"
          >
            <div className="text-3xl mb-2">☕</div>
            <div className="font-semibold">Ko-fi</div>
            <div className="text-xs text-text-tertiary mt-1">Invítame a un café.</div>
          </a>
        ) : null}
        {sponsors.enabled && sponsorsUrl ? (
          <a
            href={sponsorsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-2xl border border-violet-500/30 bg-violet-500/5 p-5 hover:bg-violet-500/10 transition-colors"
          >
            <div className="text-3xl mb-2">💖</div>
            <div className="font-semibold">GitHub Sponsors</div>
            <div className="text-xs text-text-tertiary mt-1">Apoyo mensual al proyecto.</div>
          </a>
        ) : null}
      </div>

      <SupportButton />
    </div>
  )
}
