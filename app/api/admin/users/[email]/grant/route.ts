import { NextRequest, NextResponse } from 'next/server'
import { getCurrentAdmin } from '@/lib/admin/auth'
import { db } from '@/lib/db'
import { randomBytes } from 'crypto'
import { safeDecode } from '@/lib/api/params'

interface GrantPayload {
  kind: 'premium' | 'stations'
  expiresAt?: number | null
  reason?: string
  plan?: 'monthly' | 'yearly'
}

/** Grant a manual subscription (no Stripe required). The entitlement
 *  token is created/linked so the user can claim it via /premium/claim
 *  with their email. */
// Estas rutas usan `node:crypto` (randomBytes/scrypt), que no existe en el
// runtime Edge. Next 16 usa Node por defecto para route handlers, pero
// declararlo lo hace explícito y evita que un cambio de default lo rompa.
export const runtime = 'nodejs'

export async function POST(req: NextRequest, { params }: { params: Promise<{ email: string }> }) {
  const admin = await getCurrentAdmin()
  if (!admin) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  const { email } = await params
  const decodedPost = safeDecode(email)
  if (decodedPost === null) {
    return NextResponse.json({ ok: false, error: 'malformed_email' }, { status: 400 })
  }
  const userEmail = decodedPost.toLowerCase()
  let body: GrantPayload
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 })
  }
  if (body.kind !== 'premium' && body.kind !== 'stations') {
    return NextResponse.json({ ok: false, error: 'invalid_kind' }, { status: 400 })
  }
  const grantId = randomBytes(10).toString('hex')
  const now = Date.now()
  const subId = `manual_${grantId}`
  const token = randomBytes(20).toString('hex')
  const periodEnd = body.expiresAt ?? now + 365 * 24 * 60 * 60 * 1000 // default 1y

  try {
    // AUDITORIA: era un INSERT pelado contra una tabla con
    // UNIQUE(email, kind). Conceder Premium por segunda vez a la misma
    // persona —renovar un regalo, corregir una fecha— fallaba con 500 y
    // devolvia el mensaje CRUDO de libsql en el cuerpo de la respuesta.
    // Se reemplaza la concesion anterior de ese (email, kind) en el
    // mismo lote atomico.
    await db.batchOrThrow([
      {
        sql: 'DELETE FROM subscriptions WHERE email = ? AND kind = ?',
        args: [userEmail, body.kind],
      },
      {
        sql: `INSERT INTO subscriptions (email, kind, stripe_customer_id, stripe_subscription_id, status, plan, current_period_end, entitlement_token, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`,
        args: [userEmail, body.kind, null, subId, body.plan ?? 'yearly', periodEnd, token, now, now],
      },
      {
        sql: `INSERT INTO user_grants (id, email, kind, reason, granted_by, granted_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [grantId, userEmail, body.kind, body.reason ?? null, admin, now, body.expiresAt ?? null],
      },
    ])
    return NextResponse.json({ ok: true, token, periodEnd })
  } catch (err) {
    // Nunca el error crudo al cliente: los mensajes de libsql llevan el
    // SQL y nombres de columna.
    console.error('[admin] grant fallido:', err instanceof Error ? err.message : err)
    return NextResponse.json({ ok: false, error: 'grant_failed' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ email: string }> }) {
  const admin = await getCurrentAdmin()
  if (!admin) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  const { email } = await params
  const decodedDelete = safeDecode(email)
  if (decodedDelete === null) {
    return NextResponse.json({ ok: false, error: 'malformed_email' }, { status: 400 })
  }
  const userEmail = decodedDelete.toLowerCase()
  const kind = req.nextUrl.searchParams.get('kind') ?? ''
  if (kind !== 'premium' && kind !== 'stations') {
    return NextResponse.json({ ok: false, error: 'invalid_kind' }, { status: 400 })
  }
  try {
    // executeOrThrow: con db.execute, una revocacion que fallaba devolvia
    // false en silencio y la ruta respondia { ok: true }. El admin creia
    // haber retirado el acceso y la persona lo conservaba.
    await db.executeOrThrow(
      `UPDATE subscriptions SET status = 'canceled', updated_at = ? WHERE email = ? AND kind = ?`,
      [Date.now(), userEmail, kind],
    )
    await db.executeOrThrow(
      `UPDATE user_grants SET revoked_at = ? WHERE email = ? AND kind = ? AND revoked_at IS NULL`,
      [Date.now(), userEmail, kind],
    )
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[admin] revocacion fallida:', err instanceof Error ? err.message : err)
    return NextResponse.json({ ok: false, error: 'revoke_failed' }, { status: 500 })
  }
}
