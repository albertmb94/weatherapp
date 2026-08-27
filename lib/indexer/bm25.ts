/**
 * BM25 (Best Matching 25) sparse vectorizer — pure deterministic
 * implementation with no ML or external embedding calls. The product
 * rule for Sprint 10 is "no LLMs, no inference" in the repo; this
 * module is the lexical-search engine that drives `weather_chunks` in
 * Qdrant.
 *
 * Design choices:
 *   - Standard BM25 parameters: k1 = 1.5, b = 0.75.
 *   - Tokenisation: lowercase + split on non-alphanumeric (preserves
 *     CamelCase, snake_case, kebab-case tokens). Designed for code
 *     identifiers, not prose.
 *   - Stopwords: a tiny built-in English list to keep IDF meaningful
 *     for very short documents (otherwise `the`, `a`, `to`, ... eat
 *     the score).
 *   - Pure functions: `tokenize`, `termFrequencies`, `buildIndex`,
 *     `vectorize`. The Qdrant shape is built from `vectorize`.
 *
 * Sparse Qdrant vectors are encoded as `Record<number, number>` where
 * the key is the term's index in the vocabulary and the value is the
 * BM25 score. Qdrant's `VectorParams.Sparse()` accepts exactly this
 * format, so the indexer can pass it through unchanged.
 */

const STOPWORDS = new Set([
  'the', 'a', 'an', 'to', 'of', 'in', 'on', 'for', 'and', 'or',
  'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'it', 'its', 'this', 'that', 'these', 'those',
  'with', 'as', 'by', 'at', 'from',
])

/** Tokenise one document into a list of lowercase alphanumeric tokens. */
export function tokenize(text: string): string[] {
  const out: string[] = []
  // Split on anything that isn't a letter or a digit; preserves
  // identifiers like `InsightsTable`, `ecmwf_ifs`, `wind_speed_10m`.
  const re = /[A-Za-z0-9_]+/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const tok = m[0].toLowerCase()
    if (tok.length < 2) continue
    if (STOPWORDS.has(tok)) continue
    out.push(tok)
  }
  return out
}

/** Per-document term frequency map. Tokens are normalised (lowercased)
 *  here so the corpus path and the query path agree on the same
 *  string form regardless of how the caller pre-processed them. */
export function termFrequencies(tokens: string[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const raw of tokens) {
    const t = raw.toLowerCase()
    out.set(t, (out.get(t) ?? 0) + 1)
  }
  return out
}

/** Per-term document frequency (count of docs containing the term).
 *  Used internally by `buildIndex`; exported for testability. */
export function documentFrequencies(docs: string[][]): Map<string, number> {
  const out = new Map<string, number>()
  for (const doc of docs) {
    const seen = new Set<string>()
    for (const raw of doc) {
      const t = raw.toLowerCase()
      if (seen.has(t)) continue
      seen.add(t)
      out.set(t, (out.get(t) ?? 0) + 1)
    }
  }
  return out
}

export interface BM25Index {
  /** Sorted vocabulary: term → index. Stable across the corpus. */
  vocabulary: Map<string, number>
  /** idf[t] for each vocabulary index, pre-computed. */
  idf: Float64Array
  /** Average document length (in tokens). */
  avgDocLen: number
  /** Number of documents the index was built over. */
  docCount: number
  /** k1 and b used to build the index. Defaults are 1.5 / 0.75. */
  k1: number
  b: number
}

export interface BM25Options {
  k1?: number
  b?: number
}

const DEFAULT_K1 = 1.5
const DEFAULT_B = 0.75

/**
 * Build the BM25 index for a corpus of tokenised documents.
 * Vocabulary is alphabetically sorted so the same term always gets the
 * same integer index across calls. Tokens are normalised
 * (lowercased) here so the corpus and the query path agree on the
 * same string form regardless of how the caller pre-processed them.
 */
export function buildIndex(
  tokenisedDocs: string[][],
  options: BM25Options = {}
): BM25Index {
  const k1 = options.k1 ?? DEFAULT_K1
  const b = options.b ?? DEFAULT_B
  const df = documentFrequencies(tokenisedDocs)
  const N = tokenisedDocs.length
  const totalLen = tokenisedDocs.reduce((s, d) => s + d.length, 0)
  const avgDocLen = N > 0 ? totalLen / N : 0

  const vocab = new Map<string, number>()
  const sortedTerms = [...df.keys()].sort()
  for (const term of sortedTerms) vocab.set(term, vocab.size)

  const idf = new Float64Array(vocab.size)
  for (const [term, idx] of vocab.entries()) {
    const dft = df.get(term) ?? 0
    // BM25+ IDF variant (safe for empty df and N=1).
    idf[idx] = Math.log(1 + (N - dft + 0.5) / (dft + 0.5))
  }
  return { vocabulary: vocab, idf, avgDocLen, docCount: N, k1, b }
}

/**
 * Vectorise one document against a pre-built BM25 index.
 *
 * Returns a sparse representation: `{ [termIndex: number]: bm25Score }`.
 * Empty input → empty object. Qdrant's sparse vector type accepts
 * exactly this shape.
 */
export function vectorize(
  tokens: string[],
  index: BM25Index,
  options: BM25Options = {}
): Record<number, number> {
  const k1 = options.k1 ?? index.k1 ?? DEFAULT_K1
  const b = options.b ?? index.b ?? DEFAULT_B
  const tf = termFrequencies(tokens)
  const out: Record<number, number> = {}
  for (const [term, freq] of tf.entries()) {
    const idx = index.vocabulary.get(term)
    if (idx === undefined) continue
    const idf = index.idf[idx] ?? 0
    const dl = tokens.length
    const norm = 1 - b + (b * dl) / (index.avgDocLen || 1)
    const tfNorm = (freq * (k1 + 1)) / (freq + k1 * norm)
    const score = idf * tfNorm
    if (score > 0) out[idx] = score
  }
  return out
}

/**
 * Build a sparse query vector the same way we vectorise documents so
 * the scoring is symmetric. Currently identical to `vectorize`; kept
 * as a separate name so future query-specific tweaks (e.g. boosting
 * rare terms) don't leak into the doc path.
 */
export function vectorizeQuery(
  query: string,
  index: BM25Index,
  options: BM25Options = {}
): Record<number, number> {
  return vectorize(tokenize(query), index, options)
}
