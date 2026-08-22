import { NextRequest, NextResponse } from 'next/server'
import { consumeMagicLink, setAdminCookie } from '@/lib/admin/auth'
import { db } from '@/lib/db'
import { generateToken } from '@/lib/admin/auth'
import { ADMIN_SESSION_TTL_MS } from '@/lib/admin/auth'

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token') ?? ''
  if (!token) {
    return NextResponse.redirect(new URL('/admin/login?error=missing', req.url))
  }
  const email = await consumeMagicLink(token)
  if (!email) {
    return NextResponse.redirect(new URL('/admin/login?error=invalid', req.url))
  }
  // The magic-link row was deleted by consumeMagicLink. Mint a fresh
  // session token so the cookie stays valid for SESSION_TTL_MS,
  // independent of the magic-link short window.
  const sessionToken = generateToken()
  const now = Date.now()
  try {
    await db.execute(
      'INSERT INTO admin_sessions (token, email, kind, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
      [sessionToken, email, 'session', now + ADMIN_SESSION_TTL_MS, now],
    )
  } catch (err) {
    // B-NBT-9c fix: the old fallback set the session cookie to the
    // magic-link token that `consumeMagicLink` had JUST deleted — a
    // guaranteed-invalid credential dressed up as graceful degradation.
    // Without a DB there is nothing to authenticate against; send the
    // user back to the login screen with a clear error instead.
    console.warn('[admin] failed to create session row', err)
    return NextResponse.redirect(new URL('/admin/login?error=storage', req.url))
  }
  await setAdminCookie(sessionToken)
  return NextResponse.redirect(new URL('/admin', req.url))
}
