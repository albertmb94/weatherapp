/**
 * Project chunker — converts source files into search-indexable
 * chunks. Pure functions; no FS access (the indexer script owns I/O).
 *
 * Design:
 *   - `.md` → split by `^#`/`^##` headers; each chunk = header + body.
 *     Files without a header produce a single chunk.
 *   - `.ts`/`.tsx`/`.js`/`.mjs` → if the file is small enough (≤ 400
 *     lines), emit the whole file as one chunk. Otherwise split by
 *     top-level `export` declarations (function, const, class) using
 *     a regex splitter; the file header up to the first export is its
 *     own chunk.
 *   - `.json` → 1 chunk per file (mostly package.json / tsconfig.json).
 *   - everything else → skipped by the indexer's caller.
 *
 * Each chunk carries a stable `id = path + startLine + contentHash`
 * so re-indexing is idempotent: the same content always produces the
 * same id.
 */
import { createHash } from 'node:crypto'

export type Language = 'markdown' | 'typescript' | 'json' | 'unknown'

export interface Chunk {
  id: string
  path: string
  startLine: number
  endLine: number
  language: Language
  content: string
  /** Optional human-readable label, e.g. an exported function name or a
   *  markdown section heading. */
  summary?: string
}

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16)
}

function chunkId(path: string, startLine: number, content: string): string {
  return `${path}:${startLine}:${hashContent(content)}`
}

function detectLanguage(path: string): Language {
  if (/\.(md|markdown)$/i.test(path)) return 'markdown'
  if (/\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(path)) return 'typescript'
  if (/\.json$/i.test(path)) return 'json'
  return 'unknown'
}

/**
 * Split markdown content by headers (`#` or `##`). Each chunk spans
 * from one header to the next (or to end-of-file). Lines before the
 * first header (e.g. leading HTML or frontmatter) become their own
 * chunk with no summary.
 */
function chunkMarkdown(content: string, path: string): Chunk[] {
  const lines = content.split(/\r?\n/)
  const chunks: Chunk[] = []
  let currentStart = 0
  let currentHeader: string | null = null

  function flush(endLine: number) {
    const slice = lines.slice(currentStart, endLine).join('\n')
    if (!slice.trim()) return
    chunks.push({
      id: chunkId(path, currentStart + 1, slice),
      path,
      startLine: currentStart + 1,
      endLine,
      language: 'markdown',
      content: slice,
      summary: currentHeader ?? undefined,
    })
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^#{1,2}\s+/.test(line)) {
      // Close the previous chunk, start a new one
      flush(i)
      currentStart = i
      currentHeader = line.replace(/^#{1,2}\s+/, '').trim()
    }
  }
  flush(lines.length)
  return chunks
}

/**
 * Find top-level `export` declarations and return the line ranges
 * they occupy (start inclusive, end exclusive). Uses a simple regex
 * because we only need approximate ranges for chunking, not a full
 * AST.
 */
function findExportRanges(content: string): Array<{
  start: number
  end: number
  name: string
}> {
  const lines = content.split(/\r?\n/)
  const ranges: Array<{ start: number; end: number; name: string }> = []
  const exportRe =
    /^export\s+(?:default\s+)?(?:async\s+)?(?:function|class)\s+([A-Za-z0-9_$]+)|^export\s+(?:default\s+)?(?:const|let|var)\s+([A-Za-z0-9_$]+)/
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(exportRe)
    if (!m) continue
    const name = m[1] ?? m[2] ?? '(anonymous)'
    // Find the matching close-brace by counting. Skips braces in
    // strings/regexes — good enough for source-code chunking.
    let depth = 0
    let started = false
    let end = lines.length
    for (let j = i; j < lines.length; j++) {
      for (const ch of lines[j]) {
        if (ch === '{') {
          depth++
          started = true
        } else if (ch === '}') {
          depth--
        }
      }
      if (started && depth === 0) {
        end = j + 1
        break
      }
      // If the export has no braces (single-line) the loop above
      // never opens; treat the line itself as the range.
      if (j === i && !lines[j].includes('{')) {
        end = j + 1
        break
      }
    }
    ranges.push({ start: i, end, name })
  }
  return ranges
}

/**
 * Chunk a TS/TSX file. Header (imports, top-level types) becomes its
 * own chunk; each export becomes a chunk. We cap export chunks at
 * MAX_LINES so a huge exported type doesn't blow up the index.
 */
const MAX_TS_LINES = 400

function chunkTypeScript(content: string, path: string): Chunk[] {
  const lines = content.split(/\r?\n/)
  if (lines.length <= MAX_TS_LINES) {
    return [
      {
        id: chunkId(path, 1, content),
        path,
        startLine: 1,
        endLine: lines.length,
        language: 'typescript',
        content,
      },
    ]
  }
  const exports = findExportRanges(content)
  if (exports.length === 0) {
    // Big file with no top-level exports — fall back to half-half.
    const mid = Math.floor(lines.length / 2)
    return [
      {
        id: chunkId(path, 1, lines.slice(0, mid).join('\n')),
        path,
        startLine: 1,
        endLine: mid,
        language: 'typescript',
        content: lines.slice(0, mid).join('\n'),
      },
      {
        id: chunkId(path, mid + 1, lines.slice(mid).join('\n')),
        path,
        startLine: mid + 1,
        endLine: lines.length,
        language: 'typescript',
        content: lines.slice(mid).join('\n'),
      },
    ]
  }

  const chunks: Chunk[] = []
  // Header = everything before the first export.
  const firstStart = exports[0].start
  if (firstStart > 0) {
    const headContent = lines.slice(0, firstStart).join('\n')
    if (headContent.trim()) {
      chunks.push({
        id: chunkId(path, 1, headContent),
        path,
        startLine: 1,
        endLine: firstStart,
        language: 'typescript',
        content: headContent,
      })
    }
  }
  for (let i = 0; i < exports.length; i++) {
    const e = exports[i]
    const slice = lines.slice(e.start, e.end).join('\n')
    if (!slice.trim()) continue
    chunks.push({
      id: chunkId(path, e.start + 1, slice),
      path,
      startLine: e.start + 1,
      endLine: e.end,
      language: 'typescript',
      content: slice,
      summary: e.name,
    })
  }
  return chunks
}

function chunkJson(content: string, path: string): Chunk[] {
  return [
    {
      id: chunkId(path, 1, content),
      path,
      startLine: 1,
      endLine: content.split(/\r?\n/).length,
      language: 'json',
      content,
    },
  ]
}

/**
 * Chunk one file. Returns an empty array for unsupported extensions
 * so the caller can filter trivially.
 */
export function chunkFile(path: string, content: string): Chunk[] {
  const lang = detectLanguage(path)
  switch (lang) {
    case 'markdown':
      return chunkMarkdown(content, path)
    case 'typescript':
      return chunkTypeScript(content, path)
    case 'json':
      return chunkJson(content, path)
    default:
      return []
  }
}
