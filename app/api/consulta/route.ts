/**
 * POST /api/consulta — natural-language weather query → typed params.
 *
 * Body:
 *   {
 *     q: string,                                  // required, ≤ 500 chars
 *     locale?: 'es' | 'en',                       // defaults to 'es'
 *     candidatos?: { id: string; nombre: string }[]  // known places to choose from
 *   }
 *
 * Response 200:
 *   { params: ConsultaParams, modelo: string, uso: { entrada, salida } }
 *
 * Degradation: without TYPESAFE_API_KEY the route answers 503
 * `{ configured: false }` instead of throwing — same contract as the
 * AEMET / Meteocat routes. The caller keeps whatever state it had.
 *
 * The route is the only place that talks to TypeSafe; the question shape
 * and the answer → params mapping live in `lib/consulta.ts` and are pure.
 */

import { NextResponse } from 'next/server'
import { rateLimit } from '@/lib/rateLimit'
import {
  APIError,
  RateLimitError,
  getTypeSafeClient,
  isTypeSafeConfigured,
  TypeSafeNotConfiguredError,
} from '@/lib/typesafe'
import {
  buildConsultaQuestions,
  sanitizeCandidatos,
  toConsultaParams,
  type Locale,
} from '@/lib/consulta'

/** Longest accepted query. Roughly a paragraph; longer is prompt abuse. */
const MAX_Q = 500
/** TypeSafe calls cost money — tighter than the 30/min default. */
const CONSULTA_RATE_LIMIT = 10

export async function POST(request: Request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (!rateLimit(`consulta:${ip}`, CONSULTA_RATE_LIMIT)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const raw = (body ?? {}) as { q?: unknown; locale?: unknown; candidatos?: unknown }
  const q = typeof raw.q === 'string' ? raw.q.trim() : ''
  if (!q) return NextResponse.json({ error: 'Missing q' }, { status: 400 })
  if (q.length > MAX_Q) {
    return NextResponse.json({ error: `q exceeds ${MAX_Q} characters` }, { status: 400 })
  }

  const locale: Locale = raw.locale === 'en' ? 'en' : 'es'
  const candidatos = sanitizeCandidatos(raw.candidatos)

  if (!isTypeSafeConfigured()) {
    return NextResponse.json(
      { error: 'TypeSafe not configured', configured: false },
      { status: 503 },
    )
  }

  try {
    const client = getTypeSafeClient()
    const result = await client.systemOne({
      state: { consulta: q, idioma: locale },
      questions: buildConsultaQuestions({ candidatos, locale }),
    })

    return NextResponse.json({
      params: toConsultaParams(result.answers, { candidatos }),
      modelo: result.model,
      uso: { entrada: result.usage.input_tokens, salida: result.usage.output_tokens },
    })
  } catch (err) {
    if (err instanceof TypeSafeNotConfiguredError) {
      return NextResponse.json(
        { error: 'TypeSafe not configured', configured: false },
        { status: 503 },
      )
    }
    // TypeSafe's own 429 (account-level), distinct from our per-IP one.
    if (err instanceof RateLimitError) {
      return NextResponse.json({ error: 'TypeSafe rate limit exceeded' }, { status: 429 })
    }
    if (err instanceof APIError) {
      console.error('[consulta] TypeSafe APIError:', err.status, err.message)
      return NextResponse.json({ error: 'TypeSafe request failed' }, { status: 502 })
    }
    console.error('[consulta] unexpected error:', err)
    return NextResponse.json({ error: 'TypeSafe request failed' }, { status: 502 })
  }
}
