import { StubPage } from '@/components/admin/StubPage'

export default function AdsPage() {
  return (
    <StubPage
      title="Ads"
      description="Bloques de Google AdSense y EthicalAds. Configurados desde /admin/features."
    >
      <p className="text-xs text-text-tertiary">
        Sprint 3 pendiente: implementación de slots con feature flags + consentimiento CMP.
      </p>
    </StubPage>
  )
}
