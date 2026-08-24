import { getFeature } from '@/lib/features'
import FeatureConfigForm from '@/components/admin/FeatureConfigForm'

export const dynamic = 'force-dynamic'

const FIELDS = [
  { key: 'client_id', label: 'AdSense Client ID (ca-pub-…)', type: 'string' as const },
  { key: 'slot_sidebar', label: 'Ad Slot ID (sidebar)', type: 'string' as const },
  { key: 'slot_feed', label: 'Ad Slot ID (in-feed)', type: 'string' as const },
]

export default async function AdsPage() {
  const flag = await getFeature('feature.ads.adsense')
  return (
    <div className="p-6 space-y-6">
      <header>
        <h1 className="text-xl font-semibold">Ads</h1>
        <p className="text-sm text-text-tertiary">Configura los bloques publicitarios de la app.</p>
      </header>

      <FeatureConfigForm
        featureKey="feature.ads.adsense"
        title="Google AdSense"
        description="Introduce las credenciales de AdSense. El slot aparece en la home para usuarios free."
        fields={FIELDS}
        initialConfig={flag.config}
      />

      <div className="rounded-2xl border border-border bg-surface-raised p-4">
        <h3 className="text-xs uppercase tracking-widest text-text-tertiary mb-2">Cómo funciona</h3>
        <ul className="text-xs text-text-secondary space-y-1 list-disc pl-4">
          <li>El slot solo se muestra a usuarios free (premium tiene showAds=false).</li>
          <li>Necesitas activar el toggle «Activo» arriba para que el componente lo renderice.</li>
          <li>Los valores se guardan en feature_flags.config y se sirven vía /api/features.</li>
        </ul>
      </div>
    </div>
  )
}
