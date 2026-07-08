import { describe, expect, it } from 'vitest'
import { makeTempoHintDiff, mineTempoCandidates } from './tempoLearning'
import type { CompositionHistoryEntry, LyricsPromptHistoryEntry, ClaudeCompositionHistoryEntry } from '../../types/persistence'

function compositionEntry(genreKey: string, tempo: number | undefined, rating: number | undefined): CompositionHistoryEntry {
  return {
    id: crypto.randomUUID(),
    kind: 'composition',
    createdAt: new Date().toISOString(),
    tags: [],
    rating,
    input: { genreKey, instrumentKeys: [], atmosphereKeys: [], tempo },
    variants: [],
  }
}

function lyricsEntry(genreKey: string, rating: number): LyricsPromptHistoryEntry {
  return {
    id: crypto.randomUUID(),
    kind: 'lyricsPrompt',
    createdAt: new Date().toISOString(),
    tags: [],
    rating,
    input: { genreKey, atmosphereKeys: [], themeKeywords: [], languageKey: 'ja' },
    variants: [],
  }
}

function claudeCompositionEntry(
  genreKey: string,
  tempo: number | undefined,
  rating: number | undefined,
): ClaudeCompositionHistoryEntry {
  return {
    id: crypto.randomUUID(),
    kind: 'claudeComposition',
    createdAt: new Date().toISOString(),
    tags: [],
    rating,
    input: { genreKey, instrumentKeys: [], atmosphereKeys: [], tempo },
    variants: [],
  }
}

describe('mineTempoCandidates', () => {
  it('proposes the tempo used in enough high-rated samples for a genre', () => {
    const candidates = mineTempoCandidates([
      compositionEntry('jrock', 128, 5),
      compositionEntry('jrock', 128, 4),
    ])
    expect(candidates).toEqual([{ genreKey: 'jrock', tempo: 128, sampleCount: 2, averageRating: 4.5 }])
  })

  it('ignores unrated entries, entries without a tempo, and lyrics-prompt entries (no tempo field)', () => {
    expect(
      mineTempoCandidates([
        compositionEntry('jrock', 128, undefined),
        compositionEntry('jrock', undefined, 5),
        lyricsEntry('jrock', 5),
      ]),
    ).toEqual([])
  })

  it('requires at least 2 samples and an average rating of 4+', () => {
    expect(mineTempoCandidates([compositionEntry('jrock', 128, 5)])).toEqual([])
    expect(
      mineTempoCandidates([compositionEntry('jrock', 128, 3), compositionEntry('jrock', 128, 3)]),
    ).toEqual([])
  })

  it('picks the best-performing tempo per genre when multiple tempos were used', () => {
    const candidates = mineTempoCandidates([
      compositionEntry('jrock', 120, 4),
      compositionEntry('jrock', 120, 4),
      compositionEntry('jrock', 140, 5),
      compositionEntry('jrock', 140, 5),
      compositionEntry('jrock', 140, 5),
    ])
    expect(candidates).toHaveLength(1)
    expect(candidates[0].tempo).toBe(140)
  })

  it('excludes genres that already have a tempo hint', () => {
    const candidates = mineTempoCandidates(
      [compositionEntry('jrock', 128, 5), compositionEntry('jrock', 128, 5)],
      ['jrock'],
    )
    expect(candidates).toEqual([])
  })

  it('also mines tempo candidates from claudeComposition entries (shares the composition input shape)', () => {
    const candidates = mineTempoCandidates([
      claudeCompositionEntry('jrock', 128, 5),
      claudeCompositionEntry('jrock', 128, 4),
    ])
    expect(candidates).toEqual([{ genreKey: 'jrock', tempo: 128, sampleCount: 2, averageRating: 4.5 }])
  })

  it('keeps different genres separate', () => {
    const candidates = mineTempoCandidates([
      compositionEntry('jrock', 128, 5),
      compositionEntry('jrock', 128, 5),
      compositionEntry('pop', 100, 4),
      compositionEntry('pop', 100, 4),
    ])
    expect(candidates.map((c) => c.genreKey).sort()).toEqual(['jrock', 'pop'])
  })
})

describe('makeTempoHintDiff', () => {
  it('produces a tempoHint diff with an evidence-based reason', () => {
    const diff = makeTempoHintDiff({ genreKey: 'jrock', tempo: 128, sampleCount: 3, averageRating: 4.7 })
    expect(diff.kind).toBe('tempoHint')
    expect(diff.genreKey).toBe('jrock')
    expect(diff.tempo).toBe(128)
    expect(diff.reason).toContain('jrock')
    expect(diff.reason).toContain('128')
    expect(diff.reason).toContain('3件')
    expect(diff.reason).toContain('4.7')
  })
})
