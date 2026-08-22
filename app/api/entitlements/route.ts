import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { resolveEntitlements, ENTITLEMENT_COOKIE_NAME } from '@/lib/entitlements'

/** Resolve the current user's entitlements from the entitlement cookie.
 *  Always returns the free-tier defaults when no cookie is present so
 *  the UI can render safely during SSR. */
export async function GET() {
  const cookieStore = await cookies()
  const token = cookieStore.get(ENTITLEMENT_COOKIE_NAME)?.value
  const entitlements = await resolveEntitlements(token)
  return NextResponse.json(
    { premium: entitlements.premium, stations: entitlements.stations, entitlements },
    { headers: { 'Cache-Control': 'private, max-age=10' } },
  )
}
