import { getFeature } from '@/lib/features'
import FeatureConfigForm from '@/components/admin/FeatureConfigForm'

export const dynamic = 'force-dynamic'

const FIELDS = [
  { key: 'vapid_public_key', label: 'VAPID Public Key', type: 'string' as const },
  { key: 'vapid_private_key', label: 'VAPID Private Key', type: 'password' as const },
  { key: 'vapid_subject', label: 'Subject (mailto:…)', type: 'string' as const },
]

export default async function PushPage() {
  const flag = await getFeature('feature.push')

  return (
    <div className="p-6 space-y-6">
      <header>
        <h1 className="text-xl font-semibold">Push notifications</h1>
        <p className="text-sm text-text-tertiary">
          Configura las claves VAPID para enviar push notifications a los usuarios suscritos.
        </p>
      </header>

      <FeatureConfigForm
        featureKey="feature.push"
        title="Web Push (VAPID)"
        description="Genera las claves con: npx web-push generate-vapid-keys"
        fields={FIELDS}
        initialConfig={flag.config}
      />

      <div className="rounded-2xl border border-border bg-surface-raised p-4">
        <h3 className="text-xs uppercase tracking-widest text-text-tertiary mb-2">Estado</h3>
        <p className="text-xs text-text-secondary">
          Las claves se guardan en feature_flags.config. El envío real de
          notificaciones push requiere la librería web-push (pendiente de integrar).
          Mientras tanto, las claves quedan almacenadas y listas para cuando se active.
        </p>
      </div>
    </div>
  )
}
