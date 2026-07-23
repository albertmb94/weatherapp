import { describe, it, expect } from 'vitest'
import { chunkFile } from '../chunker'

describe('chunkFile — markdown', () => {
  it('splits by H1 and H2 headers, preserving content under each', () => {
    const md = [
      '# Title',
      '',
      'Intro paragraph.',
      '',
      '## Section A',
      '',
      'Body A.',
      '',
      '## Section B',
      '',
      'Body B.',
      '',
    ].join('\n')
    const chunks = chunkFile('docs/README.md', md)
    // 4 chunks: pre-Title (none), Title, Section A, Section B.
    // Actually: Title starts at line 1, then Section A at line 5, then
    // Section B at line 9. There's no pre-Title content.
    expect(chunks.length).toBe(3)
    expect(chunks[0].summary).toBe('Title')
    expect(chunks[1].summary).toBe('Section A')
    expect(chunks[2].summary).toBe('Section B')
    expect(chunks[1].content).toContain('Body A.')
    expect(chunks[2].content).toContain('Body B.')
  })

  it('emits a single chunk for a markdown file without headers', () => {
    const md = 'Just a single paragraph of text, no headers.'
    const chunks = chunkFile('NOTES.md', md)
    expect(chunks.length).toBe(1)
    expect(chunks[0].summary).toBeUndefined()
  })

  it('produces stable ids so re-indexing is idempotent', () => {
    const md = '# T\n\nbody'
    const a = chunkFile('a.md', md)
    const b = chunkFile('a.md', md)
    expect(a[0].id).toBe(b[0].id)
  })
})

describe('chunkFile — typescript (small file)', () => {
  it('emits one chunk when the file is ≤ 400 lines', () => {
    const content = `// hello
export const x = 1
export function foo() { return 42 }
`
    const chunks = chunkFile('lib/x.ts', content)
    expect(chunks.length).toBe(1)
    expect(chunks[0].startLine).toBe(1)
    expect(chunks[0].endLine).toBe(content.split('\n').length)
  })

  it('preserves the path and language metadata', () => {
    const content = 'export const a = 1\n'
    const chunks = chunkFile('app/foo.tsx', content)
    expect(chunks[0].path).toBe('app/foo.tsx')
    expect(chunks[0].language).toBe('typescript')
  })
})

describe('chunkFile — typescript (large file)', () => {
  it('splits into header + exports when the file exceeds 400 lines', () => {
    // Build a 500-line file with imports + multiple exports.
    const headerLines = Array.from(
      { length: 50 },
      (_, i) => `import { x${i} } from 'lib${i}'`
    )
    const exportBlocks = Array.from(
      { length: 6 },
      (_, k) => {
        const body = Array.from(
          { length: 80 },
          (_, j) => `  // body line ${j} of export ${k}`
        ).join('\n')
        return `export function fn${k}() {\n${body}\n}\n`
      }
    )
    const content = [...headerLines, ...exportBlocks].join('\n')
    expect(content.split('\n').length).toBeGreaterThan(400)
    const chunks = chunkFile('lib/big.ts', content)
    expect(chunks.length).toBeGreaterThan(1)
    // First chunk is the header.
    expect(chunks[0].content).toContain('import { x0 }')
    // Subsequent chunks are exports, each with a summary.
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].summary).toMatch(/^fn\d$/)
    }
  })
})

describe('chunkFile — json', () => {
  it('emits one chunk per json file', () => {
    const json = JSON.stringify({ name: 'weather', version: '0.1.0' }, null, 2)
    const chunks = chunkFile('package.json', json)
    expect(chunks.length).toBe(1)
    expect(chunks[0].language).toBe('json')
  })
})

describe('chunkFile — unsupported', () => {
  it('returns an empty array for unsupported extensions', () => {
    expect(chunkFile('foo.png', 'binary')).toEqual([])
    expect(chunkFile('foo.lock', '{}')).toEqual([])
  })
})
