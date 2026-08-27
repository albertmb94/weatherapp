import { ADMIN_SESSION_TTL_MS } from '@/lib/admin/auth'
import PasswordChangeForm from './PasswordChangeForm'

export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const envInfo = {
    adminEmail: process.env.ADMIN_EMAIL ? 'configurado' : 'NO configurado',
    nodeEnv: process.env.NODE_ENV ?? 'unknown',
    dbType: process.env.TURSO_DATABASE_URL ? 'Turso' : 'file:local.db',
    allowFileProd: process.env.DB_ALLOW_FILE_IN_PRODUCTION === '1',
    cronSecret: process.env.CRON_SECRET ? 'configurado' : 'NO configurado',
    backtestSecret: process.env.BACKTEST_SECRET ? 'configurado' : 'NO configurado',
  }

  return (
    <div className="p-6 space-y-6">
      <header>
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="text-sm text-text-tertiary">Estado del sistema y cambio de contraseña.</p>
      </header>

      {/* Entorno */}
      <section className="rounded-2xl border border-border bg-surface-raised p-4">
        <h2 className="text-xs uppercase tracking-widest text-text-tertiary mb-3">Entorno</h2>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          {Object.entries(envInfo).map(([key, val]) => (
            <div key={key} className="flex justify-between">
              <dt className="text-text-muted">{key}</dt>
              <dd className={`font-medium ${String(val).startsWith('NO') ? 'text-red-400' : 'text-text-primary'}`}>{String(val)}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* Cambio de contraseña */}
      <section className="rounded-2xl border border-border bg-surface-raised p-4">
        <h2 className="text-xs uppercase tracking-widest text-text-tertiary mb-3">Cambiar contraseña</h2>
        <p className="text-[11px] text-text-muted mb-2">
          Sesión activa por {Math.round(ADMIN_SESSION_TTL_MS / 86400000)} días.
          La nueva contraseña se hashea con scrypt + salt aleatorio.
        </p>
        <PasswordChangeForm />
      </section>

      {/* Feature flags resumen */}
      <section className="rounded-2xl border border-border bg-surface-raised p-4">
        <h2 className="text-xs uppercase tracking-widest text-text-tertiary mb-2">Feature flags</h2>
        <p className="text-[11px] text-text-secondary">
          Gestiona los feature flags desde{' '}
          <a href="/admin/features" className="text-accent hover:underline">/admin/features</a>.
          Los valores operativos (Stripe, VAPID, AdSense) se almacenan en feature_flags.config vía el mismo panel.
        </p>
      </section>
    </div>
  )
}
