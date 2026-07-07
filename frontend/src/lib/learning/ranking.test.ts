import { describe, expect, it } from 'vitest'
import { computeScoresByCategory, rankByScore } from './ranking'
import type { CompositionHistoryEntry, LyricsPromptHistoryEntry } from '../../types/persistence'

let idCounter = 0
function nextId(): string {
  idCounter += 1
  return `entry-${idCounter}`
}

function compositionEntry(overrides: Partial<CompositionHistoryEntry> = {}): CompositionHistoryEntry {
  return {
    id: nextId(),
    kind: 'composition',
    createdAt: new Date().toISOString(),
    tags: [],
    input: { genreKey: 'jrock', instrumentKeys: ['guitar'], atmosphereKeys: ['fast_paced'] },
    variants: [
      { variantId: 'v1', styleId: 'standard', styleLabel: '標準', englishPrompt: 'x', japanesePrompt: 'x' },
      { variantId: 'v2', styleId: 'poetic', styleLabel: '詩的', englishPrompt: 'y', japanesePrompt: 'y' },
    ],
    ...overrides,
  }
}

function lyricsEntry(overrides: Partial<LyricsPromptHistoryEntry> = {}): LyricsPromptHistoryEntry {
  return {
    id: nextId(),
    kind: 'lyricsPrompt',
    createdAt: new Date().toISOString(),
    tags: [],
    input: { genreKey: 'city_pop', atmosphereKeys: [], themeKeywords: ['夏'], languageKey: 'ja' },
    variants: [{ variantId: 'v1', styleId: 'standard', styleLabel: '標準', promptText: 'x' }],
    ...overrides,
  }
}

describe('computeScoresByCategory', () => {
  it('ignores entries with no rating or a zero rating', () => {
    const entries = [compositionEntry({ rating: undefined }), compositionEntry({ rating: 0 })]
    const scores = computeScoresByCategory(entries)
    expect(scores.genreKey.size).toBe(0)
  })

  it('aggregates average rating and sample count per key', () => {
    const entries = [
      compositionEntry({ rating: 4, input: { genreKey: 'jrock', instrumentKeys: [], atmosphereKeys: [] } }),
      compositionEntry({ rating: 5, input: { genreKey: 'jrock', instrumentKeys: [], atmosphereKeys: [] } }),
    ]
    const scores = computeScoresByCategory(entries)
    expect(scores.genreKey.get('jrock')).toEqual({ sampleCount: 2, averageRating: 4.5 })
  })

  it('accumulates every key in an atmosphereKeys array separately', () => {
    const entries = [
      compositionEntry({ rating: 4, input: { genreKey: 'pop', instrumentKeys: [], atmosphereKeys: ['dark', 'emo'] } }),
    ]
    const scores = computeScoresByCategory(entries)
    expect(scores.atmosphereKeys.get('dark')).toEqual({ sampleCount: 1, averageRating: 4 })
    expect(scores.atmosphereKeys.get('emo')).toEqual({ sampleCount: 1, averageRating: 4 })
  })

  it('only aggregates instrumentKeys for composition entries, never lyricsPrompt', () => {
    const entries = [
      compositionEntry({ rating: 5, input: { genreKey: 'pop', instrumentKeys: ['guitar'], atmosphereKeys: [] } }),
      lyricsEntry({ rating: 5 }),
    ]
    const scores = computeScoresByCategory(entries)
    expect(scores.instrumentKeys.get('guitar')).toEqual({ sampleCount: 1, averageRating: 5 })
    // lyricsEntry has no instrumentKeys field at all; must not throw or pollute the map
    expect(scores.instrumentKeys.size).toBe(1)
  })

  it('only credits variantStyle when selectedVariantId matches an actual variant', () => {
    const withSelection = compositionEntry({ rating: 5, selectedVariantId: 'v2' })
    const withoutSelection = compositionEntry({ rating: 5, selectedVariantId: undefined })
    const withBogusSelection = compositionEntry({ rating: 5, selectedVariantId: 'does-not-exist' })

    const scores = computeScoresByCategory([withSelection, withoutSelection, withBogusSelection])
    expect(scores.variantStyle.get('poetic')).toEqual({ sampleCount: 1, averageRating: 5 })
    expect(scores.variantStyle.get('standard')).toBeUndefined()
  })

  it('pools genreKey/moodKey/vocalTypeKey/songStructureKey/atmosphereKeys across both composition and lyricsPrompt kinds', () => {
    const entries = [
      compositionEntry({ rating: 4, input: { genreKey: 'city_pop', instrumentKeys: [], atmosphereKeys: [] } }),
      lyricsEntry({ rating: 5, input: { genreKey: 'city_pop', atmosphereKeys: [], themeKeywords: ['夏'], languageKey: 'ja' } }),
    ]
    const scores = computeScoresByCategory(entries)
    expect(scores.genreKey.get('city_pop')).toEqual({ sampleCount: 2, averageRating: 4.5 })
  })

  it('returns empty maps for every category when there is no rated history', () => {
    const scores = computeScoresByCategory([])
    for (const category of Object.keys(scores) as (keyof typeof scores)[]) {
      expect(scores[category].size).toBe(0)
    }
  })

  it('scores lyricsPrompt entries by lyricsQualityRating instead of the prompt rating when set', () => {
    const entry = lyricsEntry({
      rating: 2,
      lyricsQualityRating: 5,
      input: { genreKey: 'city_pop', atmosphereKeys: [], themeKeywords: ['夏'], languageKey: 'ja' },
    })
    const scores = computeScoresByCategory([entry])
    expect(scores.genreKey.get('city_pop')).toEqual({ sampleCount: 1, averageRating: 5 })
  })
})

describe('rankByScore', () => {
  const options = [{ key: 'a' }, { key: 'b' }, { key: 'c' }]

  it('preserves original order when there are no scores or overrides', () => {
    const result = rankByScore(options, new Map())
    expect(result).toEqual(options)
  })

  it('ranks a higher-scoring option first', () => {
    const scores = new Map([
      ['a', { sampleCount: 5, averageRating: 3 }],
      ['b', { sampleCount: 5, averageRating: 5 }],
    ])
    const result = rankByScore(options, scores)
    expect(result[0].key).toBe('b')
  })

  it('does not let a single 5-star outlier outrank ten consistent 4-star entries', () => {
    const scores = new Map([
      ['a', { sampleCount: 1, averageRating: 5 }],
      ['b', { sampleCount: 10, averageRating: 4 }],
    ])
    const result = rankByScore(options, scores)
    expect(result[0].key).toBe('b')
  })

  it('applies an override boost on top of the implicit score', () => {
    const scores = new Map([
      ['a', { sampleCount: 5, averageRating: 3 }],
      ['b', { sampleCount: 5, averageRating: 3 }],
    ])
    const result = rankByScore(options, scores, [
      { id: 'o1', category: 'genreKey', key: 'a', boost: 100, reason: 'test', createdAt: '' },
    ])
    expect(result[0].key).toBe('a')
  })

  it('ignores overrides belonging to a different category when one is specified', () => {
    const result = rankByScore(
      options,
      new Map(),
      [{ id: 'o1', category: 'moodKey', key: 'c', boost: 100, reason: 'test', createdAt: '' }],
      'genreKey',
    )
    // moodKey override must not affect genreKey ranking -> original order preserved
    expect(result).toEqual(options)
  })

  it('does not crash when an override references a key not present in options', () => {
    expect(() =>
      rankByScore(options, new Map(), [
        { id: 'o1', category: 'genreKey', key: 'not-an-option', boost: 100, reason: 'test', createdAt: '' },
      ]),
    ).not.toThrow()
  })
})
