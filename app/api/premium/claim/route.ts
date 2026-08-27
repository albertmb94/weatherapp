import { NextRequest, NextResponse } from 'next/server'
import {
  ENTITLEMENT_COOKIE_NAME,
  ENTITLEMENT_TOKEN_TTL_MS,
  findEmailByToken,
  entitlementTokenExists,
} from '@/lib/entitlements'
import { linkVisitorIdentity } from '@/lib/analytics'

/**
 * Claim de entitlement (B-NBT-10 / auditoría F1).
 *
 * La cookie NO puede escribirse durante el render de un Server Component
 * (Next 16 lo prohibe: app/premium/claim/page.tsx lanzaba en runtime).
 * La página renderiza un formulario nativo que hace POST aquí; este
 * Route Handler valida el token, fija la cookie y redirige.
 */
export async function POST(req: NextRequest) {
  let token = ''
  try {
    const form = await req.formData()
    token = String(form.get('token') ?? '').trim()
  } catch {
    return NextResponse.redirect(new URL('/premium/claim?error=invalid', req.url), 303)
  }
  if (!token || !/^[0-9a-f]{16,64}$/i.test(token)) {
    return NextResponse.redirect(new URL('/premium/claim?error=invalid', req.url), 303)
  }

  // AUDITORIA: esto comprobaba `ent.hasAny`, que `featuresFor` devuelve
  // hoy hardcodeado a true para todo el mundo (B-NBT-14). El guard era
  // por tanto un no-op: CUALQUIER cadena hexadecimal de 16-64 caracteres
  // acunaba la cookie de 30 dias, para un token que no existia en
  // ninguna fila. Inocuo mientras todo este desbloqueado; bypass directo
  // el dia que se reactive la matriz de planes. Se valida contra la base
  // de datos, que es la unica fuente de verdad.
  if (!(await entitlementTokenExists(token))) {
    return NextResponse.redirect(new URL('/premium/claim?error=invalid', req.url), 303)
  }

  const res = NextResponse.redirect(new URL('/manage?claim=success', req.url), 303)
  const selfHostedHttp =
    process.env.DB_ALLOW_FILE_IN_PRODUCTION === '1' ||
    process.env.DB_ALLOW_FILE_IN_PRODUCTION === 'true'
  res.cookies.set({
    name: ENTITLEMENT_COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production' && !selfHostedHttp,
    maxAge: Math.floor(ENTITLEMENT_TOKEN_TTL_MS / 1000),
    path: '/',
  })

  // Único momento donde anon-id y email real coinciden: vincularlos para
  // que la vista Users del admin muestre lastSeen real (B-NBT-10).
  try {
    const email = await findEmailByToken(token)
    const anonId = req.cookies.get('wthr_anon')?.value
    if (email && anonId) {
      await linkVisitorIdentity(anonId, email)
    }
  } catch (err) {
    console.warn('[claim] identity link failed:', err instanceof Error ? err.message : err)
  }

  return res
}
