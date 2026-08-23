/**
 * Email rendering and sending. Templates live in the `email_templates`
 * table so the admin can edit copy and previews without a redeploy.
 *
 * Sending is gated behind the `feature.resend` flag â€” the function
 * fails fast with a clear error if Resend isn't configured. The same
 * guard protects the magic-link auth flow so a missing Resend key
 * doesn't silently drop admin login emails.
 */

import { Resend } from 'resend'
import { db } from '@/lib/db'
import { getFeature } from '@/lib/features'
import { randomBytes } from 'crypto'

let schemaReady: Promise<boolean> | null = null

async function ensureSchema(): Promise<boolean> {
  if (schemaReady) return schemaReady
  schemaReady = db.ensure().then(async ok => {
    if (!ok) return false
    try {
      await db.execute(
        `CREATE TABLE IF NOT EXISTS email_templates (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          subject_es TEXT NOT NULL,
          subject_en TEXT NOT NULL,
          body_es TEXT NOT NULL,
          body_en TEXT NOT NULL,
          variables TEXT,
          category TEXT NOT NULL DEFAULT 'transactional',
          enabled INTEGER NOT NULL DEFAULT 1,
          updated_at INTEGER
        )`,
      )
      await db.execute(
        `CREATE TABLE IF NOT EXISTS email_log (
          id TEXT PRIMARY KEY,
          template_id TEXT,
          recipient TEXT NOT NULL,
          subject TEXT,
          status TEXT NOT NULL,
          resend_id TEXT,
          error TEXT,
          metadata TEXT,
          sent_at INTEGER,
          sent_by TEXT
        )`,
      )
      await db.execute(
        `CREATE INDEX IF NOT EXISTS idx_email_log_recipient ON email_log(recipient, sent_at)`,
      )
      await db.execute(
        `CREATE INDEX IF NOT EXISTS idx_email_log_status ON email_log(status, sent_at)`,
      )
      return true
    } catch {
      return false
    }
  }).catch(() => { schemaReady = null; return false })
  return schemaReady
}

interface TemplateRow {
  id: string
  name: string
  subject_es: string
  subject_en: string
  body_es: string
  body_en: string
  variables: string | null
  category: string
  enabled: number | string
  updated_at: number | null
}

/** Render an email template from the DB by id, substituting `{{var}}`
 *  placeholders with the supplied values. Markdown is converted to
 *  simple HTML (headings, paragraphs, bold, links, line breaks). */
export async function renderTemplate(
  templateId: string,
  locale: 'es' | 'en',
  vars: Record<string, string>,
): Promise<{ subject: string; html: string; plainText: string; template: TemplateRow | null }> {
  if (!(await ensureSchema())) {
    throw new Error('email_log schema unavailable')
  }
  const rows = await db.select<TemplateRow>(
    'SELECT * FROM email_templates WHERE id = ?',
    [templateId],
  )
  const t = rows[0]
  if (!t) {
    throw new Error(`Template not found: ${templateId}`)
  }
  if (Number(t.enabled) !== 1) {
    throw new Error(`Template disabled: ${templateId}`)
  }
  const replace = (s: string) =>
    s.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => vars[key] ?? `{{${key}}}`)
  const subject = replace(locale === 'en' ? t.subject_en : t.subject_es)
  const body = replace(locale === 'en' ? t.body_en : t.body_es)
  return {
    subject,
    html: mdToHtml(body),
    plainText: body,
    template: t,
  }
}

/** Minimal markdown-to-HTML converter for the email body. Supports the
 *  subset the admin UI will let users write: headings, paragraphs, bold,
 *  italic, links and line breaks. Keeps the implementation dependency-free
 *  so we don't need `marked` or `react-markdown` at the edge. */
function mdToHtml(md: string): string {
  const escape = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const lines = md.split(/\r?\n/)
  const out: string[] = []
  let inList = false
  for (const raw of lines) {
    const line = raw.trimEnd()
    if (line.startsWith('# ')) {
      if (inList) {
        out.push('</ul>')
        inList = false
      }
      out.push(`<h1 style="font-size:22px;font-weight:600;margin:0 0 12px">${escape(line.slice(2))}</h1>`)
    } else if (line.startsWith('## ')) {
      if (inList) {
        out.push('</ul>')
        inList = false
      }
      out.push(`<h2 style="font-size:18px;font-weight:600;margin:16px 0 8px">${escape(line.slice(3))}</h2>`)
    } else if (line.startsWith('- ')) {
      if (!inList) {
        out.push('<ul style="margin:8px 0 16px;padding-left:20px">')
        inList = true
      }
      out.push(`<li>${inlineFormat(escape(line.slice(2)))}</li>`)
    } else if (line.length === 0) {
      if (inList) {
        out.push('</ul>')
        inList = false
      }
      out.push('<br/>')
    } else {
      if (inList) {
        out.push('</ul>')
        inList = false
      }
      out.push(`<p style="margin:0 0 12px;line-height:1.5">${inlineFormat(escape(line))}</p>`)
    }
  }
  if (inList) out.push('</ul>')
  return out.join('\n')
}

function inlineFormat(s: string): string {
  // [text](url) â†’ <a href="url">text</a>
  let out = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text: string, url: string) => {
    return `<a href="${url}" style="color:#0a7aff;text-decoration:underline">${text}</a>`
  })
  // **bold** â†’ <strong>
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  // *italic* â†’ <em>
  out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>')
  return out
}

export interface SendEmailOpts {
  to: string
  templateId?: string
  locale?: 'es' | 'en'
  vars?: Record<string, string>
  /** Override subject/html (skips template lookup) */
  subject?: string
  html?: string
  plainText?: string
  metadata?: Record<string, unknown>
  sentBy?: string
}

export interface SendEmailResult {
  ok: boolean
  error?: string
  emailLogId?: string
  resendId?: string | null
}

/** Send an email using the active Resend config. If `templateId` is set
 *  the body is rendered from the DB. Returns ok=false (without throwing)
 *  when the feature is disabled or Resend rejects the request. */
export async function sendEmail(opts: SendEmailOpts): Promise<SendEmailResult> {
  await ensureSchema()
  const logId = randomBytes(12).toString('hex')
  const now = Date.now()
  const locale = opts.locale ?? 'es'

  const baseInsert = async (status: string, error?: string, resendId?: string | null) => {
    try {
      await db.execute(
        `INSERT INTO email_log (id, template_id, recipient, subject, status, resend_id, error, metadata, sent_at, sent_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          logId,
          opts.templateId ?? null,
          opts.to,
          opts.subject ?? null,
          status,
          resendId ?? null,
          error ?? null,
          opts.metadata ? JSON.stringify(opts.metadata) : null,
          now,
          opts.sentBy ?? 'system',
        ],
      )
    } catch (err) {
      console.warn('[emails] failed to write email_log', err)
    }
  }

  // Feature gate
  const feature = await getFeature('feature.resend')
  if (!feature.enabled) {
    await baseInsert('skipped', 'feature.resend disabled')
    return { ok: false, error: 'Resend feature disabled', emailLogId: logId }
  }
  const apiKey = (feature.config.api_key as string | undefined) ?? process.env.RESEND_API_KEY
  const fromEmail =
    (feature.config.from_email as string | undefined) ??
    process.env.EMAIL_FROM ??
    'Weather <hello@example.com>'

  if (!apiKey) {
    await baseInsert('skipped', 'Resend API key missing')
    return { ok: false, error: 'Resend API key missing', emailLogId: logId }
  }

  // Resolve body
  let subject = opts.subject ?? ''
  let html = opts.html ?? ''
  let plainText = opts.plainText ?? ''
  if (opts.templateId) {
    try {
      const rendered = await renderTemplate(opts.templateId, locale, opts.vars ?? {})
      subject = rendered.subject
      html = rendered.html
      plainText = rendered.plainText
    } catch (err) {
      await baseInsert('failed', err instanceof Error ? err.message : 'Template render error')
      return { ok: false, error: 'Template render failed', emailLogId: logId }
    }
  }

  // Send via Resend
  try {
    const resend = new Resend(apiKey)
    const result = await resend.emails.send({
      from: fromEmail,
      to: opts.to,
      subject,
      html,
      text: plainText || html.replace(/<[^>]+>/g, ''),
    })
    if (result.error) {
      await baseInsert('failed', result.error.message ?? 'Resend error', null)
      return { ok: false, error: result.error.message, emailLogId: logId }
    }
    await baseInsert('sent', undefined, result.data?.id ?? null)
    return { ok: true, emailLogId: logId, resendId: result.data?.id ?? null }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Send failed'
    await baseInsert('failed', message, null)
    return { ok: false, error: message, emailLogId: logId }
  }
}

export interface EmailTemplateSummary {
  id: string
  name: string
  category: string
  enabled: boolean
  updatedAt: number | null
}

export async function listTemplates(): Promise<EmailTemplateSummary[]> {
  await ensureSchema()
  try {
    const rows = await db.select<{
      id: string
      name: string
      category: string
      enabled: number | string
      updated_at: number | null
    }>('SELECT id, name, category, enabled, updated_at FROM email_templates ORDER BY category, name')
    return rows.map(r => ({
      id: r.id,
      name: r.name,
      category: r.category,
      enabled: Number(r.enabled) === 1,
      updatedAt: r.updated_at != null ? Number(r.updated_at) : null,
    }))
  } catch {
    return []
  }
}

export async function getTemplate(id: string): Promise<TemplateRow | null> {
  await ensureSchema()
  const rows = await db.select<TemplateRow>('SELECT * FROM email_templates WHERE id = ?', [id])
  return rows[0] ?? null
}

export async function upsertTemplate(input: {
  id: string
  name: string
  subject_es: string
  subject_en: string
  body_es: string
  body_en: string
  variables?: string[]
  category?: string
  enabled?: boolean
}): Promise<boolean> {
  await ensureSchema()
  try {
    await db.execute(
      `INSERT INTO email_templates (id, name, subject_es, subject_en, body_es, body_en, variables, category, enabled, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         subject_es = excluded.subject_es,
         subject_en = excluded.subject_en,
         body_es = excluded.body_es,
         body_en = excluded.body_en,
         variables = excluded.variables,
         category = excluded.category,
         enabled = excluded.enabled,
         updated_at = excluded.updated_at`,
      [
        input.id,
        input.name,
        input.subject_es,
        input.subject_en,
        input.body_es,
        input.body_en,
        input.variables ? JSON.stringify(input.variables) : null,
        input.category ?? 'transactional',
        input.enabled === false ? 0 : 1,
        Date.now(),
      ],
    )
    return true
  } catch {
    return false
  }
}

export interface EmailLogEntry {
  id: string
  templateId: string | null
  recipient: string
  subject: string | null
  status: string
  resendId: string | null
  error: string | null
  metadata: string | null
  sentAt: number | null
  sentBy: string | null
}

export async function listEmailLog(opts: {
  limit?: number
  recipient?: string
  status?: string
} = {}): Promise<EmailLogEntry[]> {
  await ensureSchema()
  const limit = opts.limit ?? 50
  const where: string[] = []
  const args: unknown[] = []
  if (opts.recipient) {
    where.push('recipient = ?')
    args.push(opts.recipient)
  }
  if (opts.status) {
    where.push('status = ?')
    args.push(opts.status)
  }
  const sql = `SELECT id, template_id, recipient, subject, status, resend_id, error, metadata, sent_at, sent_by
               FROM email_log
               ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
               ORDER BY sent_at DESC
               LIMIT ?`
  args.push(limit)
  try {
    const rows = await db.select<{
      id: string
      template_id: string | null
      recipient: string
      subject: string | null
      status: string
      resend_id: string | null
      error: string | null
      metadata: string | null
      sent_at: number | null
      sent_by: string | null
    }>(sql, args as (string | number)[])
    return rows.map(r => ({
      id: r.id,
      templateId: r.template_id,
      recipient: r.recipient,
      subject: r.subject,
      status: r.status,
      resendId: r.resend_id,
      error: r.error,
      metadata: r.metadata,
      sentAt: r.sent_at != null ? Number(r.sent_at) : null,
      sentBy: r.sent_by,
    }))
  } catch {
    return []
  }
}

/** Seed the four baseline templates. Idempotent (INSERT OR IGNORE). */
export async function seedDefaultTemplates(): Promise<void> {
  await ensureSchema()
  const defaults = [
    {
      id: 'welcome_premium',
      name: 'Bienvenido Premium',
      subject_es: 'Bienvenido a Premium',
      subject_en: 'Welcome to Premium',
      body_es:
        '# Hola {{email}}\n\nTu suscripciÃ³n **Premium** estÃ¡ activa hasta el {{period_end}}.\n\nGracias por apoyar Weather.',
      body_en:
        '# Hi {{email}}\n\nYour **Premium** subscription is active until {{period_end}}.\n\nThanks for supporting Weather.',
      variables: ['{{email}}', '{{period_end}}'],
      category: 'transactional',
      enabled: 1,
    },
    {
      id: 'cross_sell_stations',
      name: 'Cross-sell Estaciones',
      subject_es: 'Estaciones: aÃ±ade datos reales a tus predicciones',
      subject_en: 'Stations: add real data to your forecasts',
      body_es:
        '# Hola {{email}}\n\nYa tienes Premium. Por **2 â‚¬/mes mÃ¡s** desbloquea Estaciones y cruza el ensemble con observaciones reales de AEMET, Meteocat y Meteoclimatic.\n\n[AÃ±adir Estaciones]({{upgrade_url}})',
      body_en:
        '# Hi {{email}}\n\nYou already have Premium. For **â‚¬2/mo more** unlock Stations and cross-reference the ensemble with real AEMET, Meteocat and Meteoclimatic observations.\n\n[Add Stations]({{upgrade_url}})',
      variables: ['{{email}}', '{{upgrade_url}}'],
      category: 'marketing',
      enabled: 1,
    },
    {
      id: 'newsletter_confirm',
      name: 'Confirm newsletter',
      subject_es: 'Confirma tu suscripciÃ³n al newsletter',
      subject_en: 'Confirm your newsletter subscription',
      body_es:
        '# Confirma tu suscripciÃ³n\n\nHaz clic para confirmar y empezar a recibir el resumen semanal.\n\n[Confirmar]({{confirm_url}})',
      body_en:
        '# Confirm your subscription\n\nClick to confirm and start receiving the weekly digest.\n\n[Confirm]({{confirm_url}})',
      variables: ['{{confirm_url}}'],
      category: 'transactional',
      enabled: 1,
    },
    {
      id: 'premium_receipt',
      name: 'Recibo Premium',
      subject_es: 'Recibo de tu suscripciÃ³n Premium',
      subject_en: 'Your Premium receipt',
      body_es:
        '# Recibo\n\n**Plan:** {{plan}}\n**Importe:** {{amount}}\n**Fecha:** {{date}}',
      body_en:
        '# Receipt\n\n**Plan:** {{plan}}\n**Amount:** {{amount}}\n**Date:** {{date}}',
      variables: ['{{plan}}', '{{amount}}', '{{date}}'],
      category: 'transactional',
      enabled: 1,
    },
  ] as const
  for (const t of defaults) {
    try {
      await db.execute(
        `INSERT OR IGNORE INTO email_templates (id, name, subject_es, subject_en, body_es, body_en, variables, category, enabled, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          t.id,
          t.name,
          t.subject_es,
          t.subject_en,
          t.body_es,
          t.body_en,
          JSON.stringify(t.variables),
          t.category,
          t.enabled,
          Date.now(),
        ],
      )
    } catch {
      /* ignore â€” table may not exist yet */
    }
  }
}
