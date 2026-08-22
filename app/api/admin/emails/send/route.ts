import { NextRequest, NextResponse } from 'next/server'
import { getCurrentAdmin } from '@/lib/admin/auth'
import { sendEmail } from '@/lib/emails'
import { rateLimit } from '@/lib/rateLimit'

interface SendCampaignPayload {
  templateId: string
  recipients: string[]
  locale?: 'es' | 'en'
  varsByEmail?: Record<string, Record<string, string>>
}

/** Send a template to a list of recipients. The admin builds the list
 *  via the search/filter UI in /admin/users. We rate-limit to avoid
 *  burning through the Resend quota on a fat-finger send. */
export async function POST(req: NextRequest) {
  const admin = await getCurrentAdmin()
  if (!admin) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  // Per-admin throttling: 1 campaign / 5 min. Sends are heavy (up
  // to 500 recipients × 100 ms = 50 s) so we backstop accidental
  // double-clicks.
  if (!rateLimit(`admin:send:${admin}`, 12, 5 * 60_000)) {
    return NextResponse.json({ ok: false, error: 'rate_limited' }, { status: 429 })
  }
  let body: SendCampaignPayload
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 })
  }
  if (!body.templateId || !Array.isArray(body.recipients) || body.recipients.length === 0) {
    return NextResponse.json({ ok: false, error: 'missing_recipients' }, { status: 400 })
  }
  if (body.recipients.length > 500) {
    return NextResponse.json({ ok: false, error: 'too_many_recipients', limit: 500 }, { status: 400 })
  }
  const locale = body.locale ?? 'es'
  const results: { email: string; ok: boolean; error?: string }[] = []
  for (const email of body.recipients) {
    const vars = body.varsByEmail?.[email] ?? {}
    const send = await sendEmail({
      to: email,
      templateId: body.templateId,
      locale,
      vars,
      sentBy: admin,
      metadata: { kind: 'admin_campaign', templateId: body.templateId },
    })
    results.push({ email, ok: send.ok, error: send.error })
    // Tiny delay to keep us under Resend's per-second rate limits.
    await new Promise(r => setTimeout(r, 100))
  }
  return NextResponse.json({
    ok: true,
    sent: results.filter(r => r.ok).length,
    failed: results.filter(r => !r.ok).length,
    results,
  })
}
