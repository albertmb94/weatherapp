import { NextRequest, NextResponse } from 'next/server'
import { getCurrentAdmin } from '@/lib/admin/auth'
import { renderTemplate, sendEmail } from '@/lib/emails'
import { safeDecode } from '@/lib/api/params'

/** Send a test of a template to the current admin's email so they can
 *  preview it before publishing a campaign. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentAdmin()
  if (!admin) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  const { id } = await params
  const templateId = safeDecode(id)
  if (templateId === null) {
    return NextResponse.json({ ok: false, error: 'malformed_id' }, { status: 400 })
  }
  let locale: 'es' | 'en' = 'es'
  try {
    const body = await req.json()
    if (body.locale === 'en') locale = 'en'
  } catch { /* default es */ }
  const sampleVars: Record<string, string> = {
    email: admin,
    period_end: '31 de diciembre de 2026',
    plan: 'Premium (mensual)',
    amount: '5,00 €',
    date: new Date().toLocaleDateString(locale === 'en' ? 'en-US' : 'es-ES'),
    upgrade_url: 'https://weather.example.com/premium/estaciones',
    confirm_url: 'https://weather.example.com/api/newsletter/confirm/sample-token',
  }
  // Render to make sure it parses before sending
  try {
    await renderTemplate(templateId, locale, sampleVars)
  } catch (err) {
    // `String(err)` incluía el stack; se conserva el valor diagnóstico
    // (el admin está editando esa plantilla y necesita saber qué falla)
    // pero sólo el mensaje.
    return NextResponse.json(
      { ok: false, error: 'render_failed', message: err instanceof Error ? err.message : 'error' },
      { status: 400 },
    )
  }
  const send = await sendEmail({
    to: admin,
    templateId,
    locale,
    vars: sampleVars,
    sentBy: admin,
    metadata: { kind: 'admin_test_send', templateId },
  })
  return NextResponse.json(send, { status: send.ok ? 200 : 502 })
}
