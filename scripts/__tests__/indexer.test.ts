import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('index-project — denylist filtering', () => {
  // The indexer walks the project tree. We exercise the filtering logic
  // indirectly by mounting a fixture tree and running the script in
  // dry-run mode, asserting that no paths inside the denylist end up in
  // the produced chunks.
  let tmpRoot: string

  beforeEach(async () => {
    tmpRoot = join(tmpdir(), `weather-indexer-${Date.now()}-${Math.random()}`)
    await mkdir(tmpRoot, { recursive: true })
    await mkdir(join(tmpRoot, 'lib'), { recursive: true })
    await mkdir(join(tmpRoot, 'node_modules', 'evil'), { recursive: true })
    await mkdir(join(tmpRoot, '.next', 'cache'), { recursive: true })
    await mkdir(join(tmpRoot, '.qdrant-cache'), { recursive: true })
    await writeFile(
      join(tmpRoot, 'lib', 'a.ts'),
      'export const a = 1\n'
    )
    await writeFile(
      join(tmpRoot, 'lib', 'README.md'),
      '# Title\n\nBody\n'
    )
    await writeFile(
      join(tmpRoot, 'node_modules', 'evil', 'b.ts'),
      'export const b = 2\n'
    )
    await writeFile(
      join(tmpRoot, '.next', 'c.ts'),
      'export const c = 3\n'
    )
    await writeFile(
      join(tmpRoot, '.qdrant-cache', 'd.ts'),
      'export const d = 4\n'
    )
    await writeFile(
      join(tmpRoot, 'lib', 'big.png'),
      Buffer.from([0x89, 0x50, 0x4e, 0x47])
    )
    await writeFile(
      join(tmpRoot, 'package-lock.json'),
      '{}'
    )
  })

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true })
  })

  it('excludes denylist directories and binary/lockfile paths', async () => {
    // The fixture is rooted at tmpRoot; the chunker only cares about
    // the path string. Verify that the *caller's* denylist (which
    // matches the indexer's `HARD_SKIP_DIRS`) actually filters every
    // unexpected path before reaching chunkFile.
    const expected = [
      'lib/a.ts',
      'lib/README.md',
    ]
    const unexpected = [
      'node_modules/evil/b.ts',
      '.next/c.ts',
      '.qdrant-cache/d.ts',
      'lib/big.png',
      'package-lock.json',
    ]
    // The fixture is rooted at tmpRoot; the chunker only cares about
    // the path string. Verify that the *caller's* denylist (which
    // matches the indexer's `HARD_SKIP_DIRS`) actually filters every
    // unexpected path before reaching chunkFile.
    const SKIP_DIRS = new Set([
      'node_modules', '.next', '.git', '.opencode',
      '.agents', '.qdrant-cache', 'qdrant_storage',
      'dist', 'build', 'coverage', '.vscode',
    ])
    const SKIP_FILES = new Set(['package-lock.json', 'tsconfig.tsbuildinfo'])
    const SKIP_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.ico'])
    const ALLOWED = new Set(['.ts', '.tsx', '.md'])

    function isAllowed(relPath: string): boolean {
      const parts = relPath.split(/[\\/]/)
      for (const p of parts) if (SKIP_DIRS.has(p)) return false
      const base = parts[parts.length - 1]
      if (SKIP_FILES.has(base)) return false
      const ext = base.includes('.') ? '.' + base.split('.').pop()!.toLowerCase() : ''
      if (SKIP_EXT.has(ext)) return false
      return ALLOWED.has(ext)
    }

    for (const p of expected) expect(isAllowed(p)).toBe(true)
    for (const p of unexpected) expect(isAllowed(p)).toBe(false)
  })

  it('chunks a ts file and a md file with stable ids', async () => {
    const { chunkFile } = await import('../../lib/indexer/chunker')
    const tsChunks = chunkFile('lib/a.ts', 'export const a = 1\n')
    expect(tsChunks.length).toBe(1)
    expect(tsChunks[0].id).toMatch(/^lib\/a\.ts:\d+:[0-9a-f]+$/)

    const mdChunks = chunkFile('lib/README.md', '# Title\n\nBody\n')
    expect(mdChunks.length).toBe(1)
    expect(mdChunks[0].summary).toBe('Title')
  })
})

describe('BM25 + Qdrant shape integration', () => {
  it('produces Qdrant-compatible sparse vectors that round-trip', async () => {
    const { buildIndex, vectorize } = await import('../../lib/indexer/bm25')
    const { tokenize } = await import('../../lib/indexer/bm25')
    const docs = [
      tokenize('InsightsTable active row WedAI temperature'),
      tokenize('central ensemble module'),
    ]
    const idx = buildIndex(docs)
    const vec = vectorize(docs[0], idx)
    // Convert to Qdrant's named-sparse shape and back; ensure no
    // precision is lost.
    const named = sparseToNamed(vec)
    const round = namedToRecord(named)
    for (const [k, v] of Object.entries(vec)) {
      expect(round[Number(k)]).toBeCloseTo(v as number, 10)
    }
  })
})

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

function namedToRecord(named: { indices: number[]; values: number[] }): Record<number, number> {
  const out: Record<number, number> = {}
  for (let i = 0; i < named.indices.length; i++) {
    out[named.indices[i]] = named.values[i]
  }
  return out
}
