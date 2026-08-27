import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { db } from '@/lib/db'

interface EventPayload {
  name: string
  properties?: Record<string, unknown>
  ts?: number
}
interface BatchPayload {
  events: EventPayload[]
}

let schemaReady: Promise<boolean> | null = null

async function ensureSchema(): Promise<boolean> {
  if (schemaReady) return schemaReady
  schemaReady = db.ensure().then(ok => {
    if (!ok) return false
    return db.execute(
      `CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        anon_id TEXT NOT NULL,
        session_id TEXT,
        name TEXT NOT NULL,
        properties TEXT,
        ts INTEGER NOT NULL
      )`,
    ).then(() => db.execute('CREATE INDEX IF NOT EXISTS idx_events_name ON events(name, ts)'))
      .then(() => db.execute('CREATE INDEX IF NOT EXISTS idx_events_anon ON events(anon_id, ts)'))
      .then(() => db.execute('CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id)'))
      .then(() => true)
      .catch(() => false)
  }).catch(() => false)
  return schemaReady
}

export async function POST(req: NextRequest) {
  if (!(await ensureSchema())) {
    return NextResponse.json({ ok: false }, { status: 503 })
  }
  let body: BatchPayload
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 })
  }
  if (!body.events?.length) return NextResponse.json({ ok: true, count: 0 })

  const anonId = req.headers.get('x-anon-id') ?? 'unknown'
  const sessionId = req.headers.get('x-session-id') ?? null

  let count = 0
  for (const ev of body.events) {
    if (!ev.name || typeof ev.name !== 'string') continue
    try {
      await db.execute(
        `INSERT INTO events (id, anon_id, session_id, name, properties, ts) VALUES (?, ?, ?, ?, ?, ?)`,
        [
          randomBytes(8).toString('hex'),
          anonId,
          sessionId,
          ev.name.slice(0, 64),
          ev.properties ? JSON.stringify(ev.properties) : null,
          ev.ts ?? Date.now(),
        ],
      )
      count++
    } catch {
      /* skip individual failures */
    }
  }
  return NextResponse.json({ ok: true, count })
}
