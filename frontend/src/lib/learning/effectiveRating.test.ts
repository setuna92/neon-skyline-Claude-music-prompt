import { describe, expect, it } from 'vitest'
import { effectiveRating } from './effectiveRating'
import type { CompositionHistoryEntry, LyricsPromptHistoryEntry } from '../../types/persistence'

function compositionEntry(rating?: number): CompositionHistoryEntry {
  return {
    id: crypto.randomUUID(),
    kind: 'composition',
    createdAt: new Date().toISOString(),
    tags: [],
    rating,
    input: { genreKey: 'pop', instrumentKeys: [], atmosphereKeys: [] },
    variants: [],
  }
}

function lyricsEntry(rating?: number, lyricsQualityRating?: number): LyricsPromptHistoryEntry {
  return {
    id: crypto.randomUUID(),
    kind: 'lyricsPrompt',
    createdAt: new Date().toISOString(),
    tags: [],
    rating,
    lyricsQualityRating,
    input: { genreKey: 'pop', atmosphereKeys: [], themeKeywords: [], languageKey: 'ja' },
    variants: [],
  }
}

describe('effectiveRating', () => {
  it('returns the plain rating for composition entries (no lyricsQualityRating concept)', () => {
    expect(effectiveRating(compositionEntry(4))).toBe(4)
    expect(effectiveRating(compositionEntry(undefined))).toBeUndefined()
  })

  it('prefers lyricsQualityRating over rating for lyrics prompt entries when set', () => {
    expect(effectiveRating(lyricsEntry(2, 5))).toBe(5)
  })

  it('falls back to the prompt rating when lyricsQualityRating is not set (backward compatible)', () => {
    expect(effectiveRating(lyricsEntry(4, undefined))).toBe(4)
  })

  it('returns undefined when neither is set', () => {
    expect(effectiveRating(lyricsEntry(undefined, undefined))).toBeUndefined()
  })
})
