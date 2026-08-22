import { StubPage } from '@/components/admin/StubPage'

export default function SettingsPage() {
  return (
    <StubPage
      title="Settings"
      description="Variables de entorno y configuración global. La mayoría se gestiona vía .env en el VPS; las claves sensibles (Stripe, Resend, VAPID) se guardan en feature_flags.config desde /admin/features."
    >
      <p className="text-xs text-text-tertiary">
        Sprint 0+: completado para la mayoría de los casos. Pendiente: editor completo de variables de entorno.
      </p>
    </StubPage>
  )
}
