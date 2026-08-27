import { NextRequest, NextResponse } from 'next/server'
import { getCurrentAdmin } from '@/lib/admin/auth'
import { getFeature } from '@/lib/features'

/** Verify the configured Stripe Price IDs actually exist in the
 *  account. This requires the Stripe SDK to be installed; until then
 *  we return a soft "not_verified" response so the admin can still
 *  save plans without a deploy. */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentAdmin()
  if (!admin) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  await params
  const feature = await getFeature('feature.stripe')
  const config = feature.config as { secret_key?: string } | undefined
  if (!feature.enabled || !config?.secret_key) {
    return NextResponse.json({
      ok: false,
      verified: false,
      reason: 'stripe_not_configured',
      message: 'Activa la feature Stripe y añade la secret key para verificar precios.',
    })
  }
  return NextResponse.json({
    ok: true,
    verified: false,
    reason: 'stripe_sdk_pending',
    message: 'Verificación de precios con Stripe pendiente de implementación. Por ahora, asegúrate manualmente de que los Price IDs existen.',
  })
}
