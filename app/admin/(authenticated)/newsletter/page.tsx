import { getFeature } from '@/lib/features'
import { ensureNewsletterSchema } from '@/lib/newsletter'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

interface Subscriber {
  email: string
  subscribed_at: number
  confirmed_at: number | null
  unsubscribed_at: number | null
}

export default async function NewsletterPage() {
  const flag = await getFeature('feature.newsletter')
  let subscribers: Subscriber[] = []
  try {
    await ensureNewsletterSchema()
    const rows = await db.select<Subscriber>(
      'SELECT email, subscribed_at, confirmed_at, unsubscribed_at FROM newsletter_subscribers WHERE unsubscribed_at IS NULL ORDER BY subscribed_at DESC',
    )
    subscribers = rows
  } catch { /* best-effort */ }

  return (
    <div className="p-6 space-y-6">
      <header>
        <h1 className="text-xl font-semibold">Newsletter</h1>
        <p className="text-sm text-text-tertiary">
          {flag.enabled ? 'Feature activa.' : 'Feature.newsletter está DESACTIVADA — actívala en Features.'}
        </p>
      </header>

      <section className="rounded-2xl border border-border bg-surface-raised p-4">
        <h2 className="text-xs uppercase tracking-widest text-text-tertiary mb-3">
          Suscriptores ({subscribers.length})
        </h2>
        {subscribers.length === 0 ? (
          <p className="text-xs text-text-muted">Sin suscriptores aún.</p>
        ) : (
          <table className="w-full text-xs">
            <thead><tr className="text-left text-text-muted">
              <th className="px-2 py-1">Email</th>
              <th className="px-2 py-1">Suscrito</th>
            </tr></thead>
            <tbody>
              {subscribers.map(s => (
                <tr key={s.email} className="border-t border-border">
                  <td className="px-2 py-1 font-mono">{s.email}</td>
                  <td className="px-2 py-1 tabular-nums">{new Date(s.subscribed_at).toISOString().slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <div className="rounded-2xl border border-border bg-surface-raised p-4 space-y-2">
        <h3 className="text-xs uppercase tracking-widest text-text-tertiary">Enviar campaña</h3>
        <p className="text-[11px] text-text-secondary">
          Usa la pestaña Emails → Templates para crear el contenido,
          luego /admin/emails → send para enviarlo a los suscriptores.
          La infraestructura de envío ya está operativa vía Resend.
        </p>
      </div>
    </div>
  )
}
