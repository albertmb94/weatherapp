import { describe, it, expect } from 'vitest'
import {
  tokenize,
  termFrequencies,
  buildIndex,
  vectorize,
  vectorizeQuery,
} from '../bm25'

describe('tokenize', () => {
  it('lowercases and splits on non-alphanumeric chars', () => {
    expect(tokenize('Hello, World! 42 Foo_Bar')).toEqual([
      'hello',
      'world',
      '42',
      'foo_bar',
    ])
  })

  it('keeps camelCase identifiers as single tokens', () => {
    expect(tokenize('InsightsTable.computeCurrentSnapshot'))
      .toEqual(['insightstable', 'computecurrentsnapshot'])
  })

  it('drops very short tokens and English stopwords', () => {
    expect(tokenize('The quick brown fox is a cat to be or not')).toEqual([
      'quick',
      'brown',
      'fox',
      'cat',
      'not',
    ])
  })

  it('returns an empty list for empty input', () => {
    expect(tokenize('')).toEqual([])
    expect(tokenize('   ')).toEqual([])
  })
})

describe('termFrequencies', () => {
  it('counts each occurrence', () => {
    expect(termFrequencies(['a', 'b', 'a', 'c', 'b', 'a'])).toEqual(
      new Map([
        ['a', 3],
        ['b', 2],
        ['c', 1],
      ])
    )
  })
})

describe('buildIndex', () => {
  it('sorts the vocabulary alphabetically for stable indices', () => {
    const idx = buildIndex([
      ['zebra', 'apple'],
      ['mango', 'apple'],
    ])
    expect([...idx.vocabulary.keys()]).toEqual(['apple', 'mango', 'zebra'])
    expect(idx.vocabulary.get('apple')).toBe(0)
    expect(idx.vocabulary.get('mango')).toBe(1)
    expect(idx.vocabulary.get('zebra')).toBe(2)
  })

  it('computes IDF with the BM25+ formula', () => {
    // 2 docs, 'rare' appears once → high IDF; 'common' appears twice → low.
    const idx = buildIndex([
      ['common', 'rare'],
      ['common', 'common'],
    ])
    const rareIdx = idx.vocabulary.get('rare')!
    const commonIdx = idx.vocabulary.get('common')!
    expect(idx.idf[rareIdx]).toBeGreaterThan(idx.idf[commonIdx])
  })

  it('handles a single-document corpus without dividing by zero', () => {
    const idx = buildIndex([['only']])
    expect(idx.docCount).toBe(1)
    expect(idx.avgDocLen).toBe(1)
    // idf should be finite
    expect(Number.isFinite(idx.idf[idx.vocabulary.get('only')!])).toBe(true)
  })

  it('computes average document length', () => {
    const idx = buildIndex([
      ['one', 'two', 'three'],
      ['one'],
    ])
    expect(idx.avgDocLen).toBe(2)
  })
})

describe('vectorize', () => {
  it('returns a sparse map keyed by term index', () => {
    const idx = buildIndex([
      ['alpha', 'beta'],
      ['alpha', 'gamma'],
    ])
    const vec = vectorize(['alpha', 'beta'], idx)
    expect(Object.keys(vec).length).toBe(2)
    expect(typeof vec[idx.vocabulary.get('alpha')!]).toBe('number')
    expect(typeof vec[idx.vocabulary.get('beta')!]).toBe('number')
  })

  it('drops terms that are not in the index', () => {
    const idx = buildIndex([['alpha']])
    const vec = vectorize(['alpha', 'unknown'], idx)
    expect(Object.keys(vec).length).toBe(1)
  })

  it('produces scores consistent with the formula (deterministic)', () => {
    const docs = [['alpha', 'beta'], ['alpha', 'gamma']]
    const idx = buildIndex(docs)
    const a = vectorize(['alpha', 'beta'], idx)
    const b = vectorize(['alpha', 'beta'], idx)
    expect(a).toEqual(b)
  })

  it('returns an empty object for an empty document', () => {
    const idx = buildIndex([['alpha']])
    expect(vectorize([], idx)).toEqual({})
  })
})

describe('vectorizeQuery', () => {
  it('produces a query vector symmetric with document vectors', () => {
    const idx = buildIndex([
      ['InsightsTable', 'computeCurrentSnapshot'],
      ['DailySummary', 'precipitation'],
    ])
    const q = vectorizeQuery('InsightsTable computeCurrentSnapshot', idx)
    const d = vectorize(['InsightsTable', 'computeCurrentSnapshot'], idx)
    expect(q).toEqual(d)
  })

  it('handles unknown terms by dropping them', () => {
    const idx = buildIndex([['alpha']])
    const q = vectorizeQuery('alpha unknown', idx)
    expect(Object.keys(q).length).toBe(1)
  })
})
