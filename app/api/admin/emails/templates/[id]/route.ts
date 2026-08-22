import { NextRequest, NextResponse } from 'next/server'
import { getCurrentAdmin } from '@/lib/admin/auth'
import { getTemplate, upsertTemplate } from '@/lib/emails'
import { safeDecode } from '@/lib/api/params'

interface TemplatePayload {
  name?: string
  subjectEs?: string
  subjectEn?: string
  bodyEs?: string
  bodyEn?: string
  variables?: string[]
  category?: string
  enabled?: boolean
}

/** B-NBT-9c: `variables` is stored as a JSON TEXT column; one corrupt
 *  row used to break GET/PUT with an unhandled SyntaxError. */
function parseVariables(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentAdmin()
  if (!admin) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  const { id } = await params
  const templateId = safeDecode(id)
  if (templateId === null) {
    return NextResponse.json({ ok: false, error: 'malformed_id' }, { status: 400 })
  }
  const template = await getTemplate(templateId)
  if (!template) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })
  return NextResponse.json({
    ok: true,
    template: {
      id: template.id,
      name: template.name,
      subjectEs: template.subject_es,
      subjectEn: template.subject_en,
      bodyEs: template.body_es,
      bodyEn: template.body_en,
      variables: parseVariables(template.variables),
      category: template.category,
      enabled: Number(template.enabled) === 1,
      updatedAt: template.updated_at != null ? Number(template.updated_at) : null,
    },
  })
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentAdmin()
  if (!admin) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  const { id } = await params
  const templateId = safeDecode(id)
  if (templateId === null) {
    return NextResponse.json({ ok: false, error: 'malformed_id' }, { status: 400 })
  }
  let body: TemplatePayload
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 })
  }
  const existing = await getTemplate(templateId)
  if (!existing) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })
  }
  const ok = await upsertTemplate({
    id: templateId,
    name: body.name ?? existing.name,
    subject_es: body.subjectEs ?? existing.subject_es,
    subject_en: body.subjectEn ?? existing.subject_en,
    body_es: body.bodyEs ?? existing.body_es,
    body_en: body.bodyEn ?? existing.body_en,
    variables: body.variables ?? parseVariables(existing.variables),
    category: body.category ?? existing.category,
    enabled: body.enabled ?? Number(existing.enabled) === 1,
  })
  if (!ok) return NextResponse.json({ ok: false, error: 'save_failed' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
