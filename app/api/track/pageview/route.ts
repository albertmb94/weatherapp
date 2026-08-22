import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { db } from '@/lib/db'

interface PageviewPayload {
  path: string
  referrer?: string
  utm_source?: string
  utm_medium?: string
  utm_campaign?: string
  country?: string
  device?: string
  browser?: string
  os?: string
  ts: number
}

let schemaReady: Promise<boolean> | null = null

async function ensureSchema(): Promise<boolean> {
  if (schemaReady) return schemaReady
  schemaReady = db.ensure().then(async ok => {
    if (!ok) return false
    try {
      await db.execute(
        `CREATE TABLE IF NOT EXISTS page_views (
          id TEXT PRIMARY KEY,
          anon_id TEXT NOT NULL,
          path TEXT NOT NULL,
          referrer TEXT,
          utm_source TEXT,
          utm_medium TEXT,
          utm_campaign TEXT,
          country TEXT,
          locale TEXT,
          user_agent_browser TEXT,
          user_agent_os TEXT,
          device_type TEXT,
          ts INTEGER NOT NULL,
          duration_ms INTEGER,
          session_id TEXT
        )`,
      )
      await db.execute('CREATE INDEX IF NOT EXISTS idx_pv_ts ON page_views(ts)')
      await db.execute('CREATE INDEX IF NOT EXISTS idx_pv_anon ON page_views(anon_id, ts)')
      await db.execute(
        `CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY,
          anon_id TEXT NOT NULL,
          started_at INTEGER NOT NULL,
          last_seen_at INTEGER NOT NULL,
          page_count INTEGER DEFAULT 0,
          country TEXT,
          device_type TEXT,
          locale TEXT,
          entry_path TEXT,
          exit_path TEXT,
          is_bounce INTEGER DEFAULT 0
        )`,
      )
      await db.execute('CREATE INDEX IF NOT EXISTS idx_sess_anon ON sessions(anon_id, started_at)')
      return true
    } catch {
      return false
    }
  }).catch(() => false)
  return schemaReady
}

export async function POST(req: NextRequest) {
  if (!(await ensureSchema())) {
    return NextResponse.json({ ok: false, reason: 'db_unavailable' }, { status: 503 })
  }
  let body: PageviewPayload
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 })
  }
  const anonId = req.headers.get('x-anon-id') ?? ''
  const sessionId = req.headers.get('x-session-id') ?? ''
  if (!anonId || !body.path) {
    return NextResponse.json({ ok: false }, { status: 400 })
  }
  const id = randomBytes(10).toString('hex')
  const ts = body.ts || Date.now()
  try {
    await db.execute(
      `INSERT INTO page_views (id, anon_id, path, referrer, utm_source, utm_medium, utm_campaign, country, locale, user_agent_browser, user_agent_os, device_type, ts, session_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        anonId,
        body.path.slice(0, 500),
        body.referrer?.slice(0, 500) ?? null,
        body.utm_source?.slice(0, 64) ?? null,
        body.utm_medium?.slice(0, 64) ?? null,
        body.utm_campaign?.slice(0, 128) ?? null,
        body.country ?? null,
        null,
        body.browser ?? null,
        body.os ?? null,
        body.device ?? null,
        ts,
        sessionId || null,
      ],
    )
    // Upsert session
    if (sessionId) {
      try {
        await db.execute(
          `INSERT INTO sessions (id, anon_id, started_at, last_seen_at, page_count, country, device_type, entry_path)
           VALUES (?, ?, ?, ?, 1, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             last_seen_at = excluded.last_seen_at,
             page_count = sessions.page_count + 1,
             exit_path = excluded.entry_path`,
          [sessionId, anonId, ts, ts, body.country ?? null, body.device ?? null, body.path.slice(0, 500)],
        )
      } catch {
        /* ignore */
      }
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
