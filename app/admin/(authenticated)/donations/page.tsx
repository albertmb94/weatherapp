import { getFeature } from '@/lib/features'
import FeatureConfigForm from '@/components/admin/FeatureConfigForm'

export const dynamic = 'force-dynamic'

const KOFI_FIELDS = [
  { key: 'url', label: 'URL de tu página Ko-fi', type: 'url' as const, placeholder: 'https://ko-fi.com/tuusuario' },
]

const SPONSORS_FIELDS = [
  { key: 'url', label: 'URL de GitHub Sponsors', type: 'url' as const, placeholder: 'https://github.com/sponsors/tuusuario' },
]

function DonationForm({ featureKey, title, icon, fields, config, enabled }: {
  featureKey: string; title: string; icon: string
  fields: { key: string; label: string; type: 'url' }[]
  config: Record<string, unknown>; enabled: boolean
}) {
  return (
    <FeatureConfigForm
      featureKey={featureKey}
      title={`${icon} ${title}`}
      description="Pega la URL pública. Aparecerá en /support cuando esté activo."
      fields={fields}
      initialConfig={config}
      enabled={enabled}
      onToggleEnabled={() => {}}
    />
  )
}

export default async function DonationsPage() {
  const kofi = await getFeature('feature.kofi')
  const sponsors = await getFeature('feature.githubsponsors')

  return (
    <div className="p-6 space-y-6">
      <header>
        <h1 className="text-xl font-semibold">Donaciones</h1>
        <p className="text-sm text-text-tertiary">Configura las URLs de donación. Se muestran en /support.</p>
      </header>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <DonationForm featureKey="feature.kofi" title="Ko-fi" icon="☕"
          fields={KOFI_FIELDS} config={kofi.config} enabled={kofi.enabled} />
        <DonationForm featureKey="feature.githubsponsors" title="GitHub Sponsors" icon="💜"
          fields={SPONSORS_FIELDS} config={sponsors.config} enabled={sponsors.enabled} />
      </div>
    </div>
  )
}
