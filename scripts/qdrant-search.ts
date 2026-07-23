#!/usr/bin/env tsx
/**
 * Sprint 10 / B-10-4 — Qdrant search CLI.
 *
 * Loads the vocabulary persisted by `scripts/index-project.ts`,
 * vectorises the user query with the same BM25 module, and queries
 * Qdrant for the top-K matches. Prints `{ path:line, snippet, score }`.
 *
 * Usage:
 *   tsx scripts/qdrant-search.ts "por qué AHORA difiere de insights temp"
 *   QDRANT_URL=http://localhost:6333 tsx scripts/qdrant-search.ts "ensemble weights"
 *
 * Env vars:
 *   QDRANT_URL — Qdrant base URL (default: http://localhost:6333)
 *   QDRANT_COLLECTION — collection name (default: weather_chunks)
 *   QDRANT_TOP_K — number of hits (default: 8)
 */

import { QdrantClient } from '@qdrant/js-client-rest'
import { readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

import {
  vectorizeQuery,
  type BM25Index,
} from '../lib/indexer/bm25'
import { tokenize } from '../lib/indexer/bm25'

const PROJECT_ROOT = resolve(__dirname, '..')
const DEFAULT_COLLECTION = 'weather_chunks'
const VOCAB_FILE = join(PROJECT_ROOT, '.qdrant-cache', 'vocab.json')

interface PersistedIndex {
  vocabulary: Record<string, number>
  idf: number[]
  avgDocLen: number
  docCount: number
  k1?: number
  b?: number
}

function loadIndex(): BM25Index {
  if (!existsSync(VOCAB_FILE)) {
    console.error(
      `[search] vocab file not found at ${VOCAB_FILE}. Run \`npm run index:project\` first.`
    )
    process.exit(1)
  }
  const raw = JSON.parse(readFileSync(VOCAB_FILE, 'utf-8')) as PersistedIndex
  const vocabulary = new Map<string, number>(
    Object.entries(raw.vocabulary).map(([k, v]) => [k, Number(v)])
  )
  const idf = new Float64Array(raw.idf)
  if (raw.k1 !== undefined) (idf as unknown as { __k1: number }).__k1 = raw.k1
  if (raw.b !== undefined) (idf as unknown as { __b: number }).__b = raw.b
  return {
    vocabulary,
    idf,
    avgDocLen: raw.avgDocLen,
    docCount: raw.docCount,
  }
}

function snippet(content: string, max = 140): string {
  const flat = content.replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  return flat.slice(0, max - 1) + '…'
}

async function main() {
  const query = process.argv.slice(2).join(' ').trim()
  if (!query) {
    console.error('Usage: tsx scripts/qdrant-search.ts "<query>"')
    process.exit(1)
  }
  const url = process.env.QDRANT_URL ?? 'http://localhost:6333'
  const collection = process.env.QDRANT_COLLECTION ?? DEFAULT_COLLECTION
  const topK = Number(process.env.QDRANT_TOP_K ?? '8')

  const index = loadIndex()
  // The persisted index carries idf + vocabulary but vectorizeQuery
  // expects a BM25Index. Cast via unknown to avoid touching the type
  // surface for a one-line serializer concern.
  const qVec = vectorizeQuery(query, index)
  const qNamed = sparseToNamed(qVec)

  const client = new QdrantClient({ url })
  const results = await client.search(collection, {
    vector: { name: 'bm25', vector: qNamed as unknown as number[] },
    limit: topK,
    with_payload: true,
  } as unknown as Parameters<typeof client.search>[1])

  if (results.length === 0) {
    console.log('[search] no matches')
    return
  }
  for (const r of results) {
    const p = (r.payload ?? {}) as {
      path?: string
      startLine?: number
      endLine?: number
      language?: string
      summary?: string
      content?: string
    }
    const score = (r as unknown as { score: number }).score
    const header = `${p.path ?? '?'}:${p.startLine ?? '?'}-${p.endLine ?? '?'}  (${p.language ?? '?'}${p.summary ? ` · ${p.summary}` : ''})`
    console.log(`\n${score.toFixed(4)}  ${header}`)
    if (p.content) console.log(`  ${snippet(p.content)}`)
  }
}

function sparseToNamed(rec: Record<number, number>): {
  indices: number[]
  values: number[]
} {
  const entries = Object.entries(rec)
    .map(([k, v]) => [Number(k), v] as const)
    .filter(([, v]) => v > 0)
    .sort((a, b) => a[0] - b[0])
  return {
    indices: entries.map(([k]) => k),
    values: entries.map(([, v]) => v),
  }
}

// Avoid an unused-import lint warning when tokenize is not used
// directly here (the query string is vectorised by vectorizeQuery).
void tokenize

main().catch(err => {
  console.error('[search] failed:', err)
  process.exit(1)
})
