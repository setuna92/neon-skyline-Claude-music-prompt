import { describe, expect, it } from 'vitest'
import { computeFavoriteCompositionCombos, computeFavoriteLyricsCombos } from './comboLearning'
import type { CompositionHistoryEntry, LyricsPromptHistoryEntry } from '../types/persistence'

function compositionEntry(
  overrides: Partial<CompositionHistoryEntry['input']>,
  rating: number | undefined,
  createdAt: string,
): CompositionHistoryEntry {
  return {
    id: crypto.randomUUID(),
    kind: 'composition',
    createdAt,
    tags: [],
    rating,
    input: {
      genreKey: 'jrock',
      instrumentKeys: [],
      atmosphereKeys: [],
      ...overrides,
    },
    variants: [],
  }
}

function lyricsEntry(
  overrides: Partial<LyricsPromptHistoryEntry['input']>,
  rating: number | undefined,
  createdAt: string,
): LyricsPromptHistoryEntry {
  return {
    id: crypto.randomUUID(),
    kind: 'lyricsPrompt',
    createdAt,
    tags: [],
    rating,
    input: {
      genreKey: 'jrock',
      atmosphereKeys: [],
      themeKeywords: [],
      languageKey: 'ja',
      ...overrides,
    },
    variants: [],
  }
}

describe('computeFavoriteCompositionCombos', () => {
  it('ignores entries with no rating or a rating below 4', () => {
    const combos = computeFavoriteCompositionCombos([
      compositionEntry({}, undefined, '2026-01-01T00:00:00.000Z'),
      compositionEntry({}, 3, '2026-01-02T00:00:00.000Z'),
    ])
    expect(combos).toEqual([])
  })

  it('groups identical combinations (ignoring array order) and averages their rating', () => {
    const combos = computeFavoriteCompositionCombos([
      compositionEntry(
        { moodKey: 'late_night_drive', instrumentKeys: ['guitar', 'drums'], atmosphereKeys: ['dark', 'fast_paced'] },
        4,
        '2026-01-01T00:00:00.000Z',
      ),
      compositionEntry(
        { moodKey: 'late_night_drive', instrumentKeys: ['drums', 'guitar'], atmosphereKeys: ['fast_paced', 'dark'] },
        5,
        '2026-01-02T00:00:00.000Z',
      ),
    ])
    expect(combos).toHaveLength(1)
    expect(combos[0].sampleCount).toBe(2)
    expect(combos[0].averageRating).toBe(4.5)
  })

  it('keeps different combinations separate and ranks by averageRating * log2(1+count)', () => {
    const combos = computeFavoriteCompositionCombos([
      compositionEntry({ moodKey: 'party' }, 5, '2026-01-01T00:00:00.000Z'),
      compositionEntry({ moodKey: 'romantic' }, 4, '2026-01-01T00:00:00.000Z'),
      compositionEntry({ moodKey: 'romantic' }, 4, '2026-01-02T00:00:00.000Z'),
    ])
    expect(combos).toHaveLength(2)
    // romantic: 4 * log2(3) ≈ 6.34 > party: 5 * log2(2) = 5
    expect(combos[0].input.moodKey).toBe('romantic')
    expect(combos[1].input.moodKey).toBe('party')
  })

  it('uses the highest-rated (then most recent) sample as the representative input for themeKeywords', () => {
    const combos = computeFavoriteCompositionCombos([
      compositionEntry({ themeKeywords: ['夏'] }, 4, '2026-01-01T00:00:00.000Z'),
      compositionEntry({ themeKeywords: ['夏', '花火'] }, 5, '2026-01-02T00:00:00.000Z'),
    ])
    expect(combos).toHaveLength(1)
    expect(combos[0].input.themeKeywords).toEqual(['夏', '花火'])
  })

  it('treats different tempo values as different combos', () => {
    const combos = computeFavoriteCompositionCombos([
      compositionEntry({ tempo: 120 }, 5, '2026-01-01T00:00:00.000Z'),
      compositionEntry({ tempo: 140 }, 5, '2026-01-02T00:00:00.000Z'),
    ])
    expect(combos).toHaveLength(2)
  })
})

describe('computeFavoriteLyricsCombos', () => {
  it('groups by genre/mood/vocal/structure/atmosphere/language, not themeKeywords', () => {
    const combos = computeFavoriteLyricsCombos([
      lyricsEntry({ themeKeywords: ['夏'] }, 5, '2026-01-01T00:00:00.000Z'),
      lyricsEntry({ themeKeywords: ['冬'] }, 4, '2026-01-02T00:00:00.000Z'),
    ])
    expect(combos).toHaveLength(1)
    expect(combos[0].sampleCount).toBe(2)
    // 最高評価(5)のサンプルが代表として採用される
    expect(combos[0].input.themeKeywords).toEqual(['夏'])
  })

  it('uses lyricsQualityRating instead of the prompt rating when recorded', () => {
    const lowPromptButGreatLyrics = lyricsEntry({}, 2, '2026-01-01T00:00:00.000Z')
    lowPromptButGreatLyrics.lyricsQualityRating = 5
    const combos = computeFavoriteLyricsCombos([lowPromptButGreatLyrics])
    expect(combos).toHaveLength(1)
    expect(combos[0].averageRating).toBe(5)
  })

  it('ignores an entry whose prompt rating is high but lyrics quality rating is below the threshold', () => {
    const goodPromptBadLyrics = lyricsEntry({}, 5, '2026-01-01T00:00:00.000Z')
    goodPromptBadLyrics.lyricsQualityRating = 2
    const combos = computeFavoriteLyricsCombos([goodPromptBadLyrics])
    expect(combos).toEqual([])
  })
})
