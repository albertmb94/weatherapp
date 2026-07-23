#!/usr/bin/env tsx
/**
 * Sprint 10 / B-10-4 — Project indexer for Qdrant.
 *
 * Walks the project (respecting .gitignore + hard-coded denylist),
 * chunks each file with `lib/indexer/chunker`, vectorises with
 * `lib/indexer/bm25`, and upserts into the `weather_chunks`
 * collection in the local Qdrant instance. Idempotent: chunk ids are
 * `sha256(path:startLine:content)` so re-running with no changes is
 * a no-op.
 *
 * Usage:
 *   tsx scripts/index-project.ts
 *   QDRANT_URL=http://localhost:6333 tsx scripts/index-project.ts
 *
 * Env vars:
 *   QDRANT_URL — Qdrant base URL (default: http://localhost:6333)
 *   QDRANT_COLLECTION — collection name (default: weather_chunks)
 *   WEATHER_INDEX_DRY_RUN=1 — chunk + vectorise but skip Qdrant
 */

import { QdrantClient } from '@qdrant/js-client-rest'
import { readFile, readdir, stat, mkdir, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import {
  tokenize,
  buildIndex,
  vectorize,
} from '../lib/indexer/bm25'
import { chunkFile, type Chunk } from '../lib/indexer/chunker'

const PROJECT_ROOT = resolve(__dirname, '..')
const DEFAULT_COLLECTION = 'weather_chunks'
const VOCAB_FILE = join(PROJECT_ROOT, '.qdrant-cache', 'vocab.json')

/** Hard-coded skips in addition to .gitignore. */
const HARD_SKIP_DIRS = new Set([
  'node_modules',
  '.next',
  '.git',
  '.opencode',
  '.agents',
  '.qdrant-cache',
  'qdrant_storage',
  'dist',
  'build',
  'coverage',
  '.vscode',
])

const SKIP_FILES = new Set([
  'package-lock.json',
  'tsconfig.tsbuildinfo',
  'local.db',
  'dev.log',
  'dev.err.log',
])

const SKIP_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico',
  '.pdf', '.zip', '.tar', '.gz',
  '.mp3', '.mp4', '.wav',
])

const ALLOWED_EXT = new Set(['.md', '.markdown', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json'])

function parseGitignore(): string[] {
  const gi = join(PROJECT_ROOT, '.gitignore')
  if (!existsSync(gi)) return []
  const text = readFileSync(gi, 'utf-8')
  return text
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'))
    .map(l => l.replace(/\/$/, ''))
}

const GITIGNORE_PATTERNS = parseGitignore()

function isIgnored(relPath: string): boolean {
  const parts = relPath.split(/[\\/]/)
  for (const part of parts) {
    if (HARD_SKIP_DIRS.has(part)) return true
  }
  const basename = parts[parts.length - 1]
  if (SKIP_FILES.has(basename)) return true
  const ext = basename.includes('.')
    ? '.' + basename.split('.').pop()!.toLowerCase()
    : ''
  if (SKIP_EXT.has(ext)) return true
  for (const pattern of GITIGNORE_PATTERNS) {
    if (pattern.includes('*')) continue // skip glob patterns for the
                                       // simple path match; the hard
                                       // skip list already covers the
                                       // important ones.
    if (parts.includes(pattern)) return true
    if (relPath === pattern) return true
  }
  return false
}

async function walk(dir: string): Promise<string[]> {
  const out: string[] = []
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return out
  }
  for (const name of entries) {
    const full = join(dir, name)
    const rel = relative(PROJECT_ROOT, full)
    if (isIgnored(rel)) continue
    let st
    try {
      st = await stat(full)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      out.push(...(await walk(full)))
    } else if (st.isFile()) {
      const ext = name.includes('.')
        ? '.' + name.split('.').pop()!.toLowerCase()
        : ''
      if (ALLOWED_EXT.has(ext)) out.push(full)
    }
  }
  return out
}

async function loadAllChunks(): Promise<Chunk[]> {
  const files = await walk(PROJECT_ROOT)
  console.log(`[indexer] found ${files.length} files to chunk`)
  const all: Chunk[] = []
  for (const file of files) {
    let text: string
    try {
      text = await readFile(file, 'utf-8')
    } catch {
      continue
    }
    const rel = relative(PROJECT_ROOT, file).replace(/\\/g, '/')
    const chunks = chunkFile(rel, text)
    all.push(...chunks)
  }
  console.log(`[indexer] produced ${all.length} chunks`)
  return all
}

async function ensureCollection(client: QdrantClient, name: string) {
  const existing = await client.getCollections()
  if (existing.collections.some(c => c.name === name)) return
  await client.createCollection(name, {
    sparse_vectors: {
      bm25: {},
    },
  })
  console.log(`[indexer] created collection "${name}"`)
}

async function main() {
  const url = process.env.QDRANT_URL ?? 'http://localhost:6333'
  const collection = process.env.QDRANT_COLLECTION ?? DEFAULT_COLLECTION
  const dryRun = process.env.WEATHER_INDEX_DRY_RUN === '1'

  const chunks = await loadAllChunks()
  if (chunks.length === 0) {
    console.log('[indexer] no chunks to index; exiting')
    return
  }

  // Tokenise once so we can build the BM25 index over the whole corpus.
  const tokenised = chunks.map(c => tokenize(c.content))
  const index = buildIndex(tokenised)
  console.log(
    `[indexer] vocab size=${index.vocabulary.size} avgDocLen=${index.avgDocLen.toFixed(1)}`
  )

  // Persist the vocabulary so the search CLI can produce query vectors
  // against the same index without rebuilding it.
  await mkdir(join(PROJECT_ROOT, '.qdrant-cache'), { recursive: true })
  await writeFile(
    VOCAB_FILE,
    JSON.stringify({
      vocabulary: Object.fromEntries(index.vocabulary),
      idf: Array.from(index.idf),
      avgDocLen: index.avgDocLen,
      docCount: index.docCount,
      k1: (index.idf as unknown as { __k1?: number }).__k1,
      b: (index.idf as unknown as { __b?: number }).__b,
    }),
    'utf-8'
  )
  console.log(`[indexer] wrote vocab to ${relative(PROJECT_ROOT, VOCAB_FILE)}`)

  if (dryRun) {
    console.log('[indexer] dry-run; skipping Qdrant upsert')
    return
  }

  const client = new QdrantClient({ url })
  await ensureCollection(client, collection)

  // Build Qdrant points in batches.
  const points = chunks.map((c, i) => {
    const sparse = vectorize(tokenised[i], index)
    return {
      id: hashToUuid(c.id),
      vector: { bm25: sparseToNamed(sparse) },
      payload: {
        path: c.path,
        startLine: c.startLine,
        endLine: c.endLine,
        language: c.language,
        summary: c.summary ?? '',
        content: c.content,
      },
    }
  })

  const BATCH = 64
  for (let i = 0; i < points.length; i += BATCH) {
    await client.upsert(collection, {
      points: points.slice(i, i + BATCH),
    } as unknown as Parameters<typeof client.upsert>[1])
    process.stdout.write(`\r[indexer] upserted ${Math.min(i + BATCH, points.length)}/${points.length}`)
  }
  process.stdout.write('\n')
  console.log(`[indexer] done. collection="${collection}" url=${url}`)
}

import { createHash } from 'node:crypto'

/**
 * Qdrant point ids must be UUIDs (or integers). Map our content-hash
 * chunk ids deterministically into a UUID v5-shaped string so we get
 * the same id across re-indexings without coordinating state.
 */
function hashToUuid(s: string): string {
  const hex = createHash('sha256').update(s).digest('hex')
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-')
}

/**
 * Qdrant's sparse vector wants `{ indices: number[], values: number[] }`.
 * Convert from our `Record<number, number>` shape.
 */
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

main().catch(err => {
  console.error('[indexer] failed:', err)
  process.exit(1)
})
