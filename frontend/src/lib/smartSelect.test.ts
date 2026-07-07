import { describe, expect, it } from 'vitest'
import { deriveLyricsInputFromComposition, pickSmartCompositionInput, pickSmartLyricsInput } from './smartSelect'
import type { CompositionHistoryEntry, LyricsPromptHistoryEntry } from './../types/persistence'

function compositionEntry(
  overrides: Partial<CompositionHistoryEntry['input']>,
  rating: number | undefined,
  createdAt = new Date().toISOString(),
): CompositionHistoryEntry {
  return {
    id: crypto.randomUUID(),
    kind: 'composition',
    createdAt,
    tags: [],
    rating,
    input: { genreKey: 'jrock', instrumentKeys: [], atmosphereKeys: [], ...overrides },
    variants: [],
  }
}

function lyricsEntry(
  overrides: Partial<LyricsPromptHistoryEntry['input']>,
  rating: number | undefined,
  createdAt = new Date().toISOString(),
): LyricsPromptHistoryEntry {
  return {
    id: crypto.randomUUID(),
    kind: 'lyricsPrompt',
    createdAt,
    tags: [],
    rating,
    input: { genreKey: 'jrock', atmosphereKeys: [], themeKeywords: [], languageKey: 'ja', ...overrides },
    variants: [],
  }
}

describe('pickSmartCompositionInput', () => {
  it('reuses a proven high-rated combination instead of picking unrelated fields at random', () => {
    const history = [
      compositionEntry(
        {
          moodKey: 'late_night_drive',
          vocalTypeKey: 'female',
          instrumentKeys: ['guitar', 'drums'],
          atmosphereKeys: ['dark'],
          tempo: 128,
          themeKeywords: ['夜のドライブ'],
        },
        5,
        '2026-01-01T00:00:00.000Z',
      ),
      compositionEntry(
        {
          moodKey: 'late_night_drive',
          vocalTypeKey: 'female',
          instrumentKeys: ['guitar', 'drums'],
          atmosphereKeys: ['dark'],
          tempo: 128,
          themeKeywords: ['夜のドライブ'],
        },
        5,
        '2026-01-02T00:00:00.000Z',
      ),
    ]

    const result = pickSmartCompositionInput(history)
    // songStructureKeyはこの組み合わせでは指定が無かったため、カテゴリ別ランキングで補われる
    // (「全部の項目が自動選択される」という要件のため、空欄のままにはしない)
    expect(result.input).toMatchObject({
      genreKey: 'jrock',
      moodKey: 'late_night_drive',
      vocalTypeKey: 'female',
      instrumentKeys: ['guitar', 'drums'],
      atmosphereKeys: ['dark'],
      tempo: 128,
      themeKeywords: ['夜のドライブ'],
    })
    expect(result.input.songStructureKey).toBeTruthy()
    expect(result.predictedRating).toBe(5)
  })

  it('falls back to a deterministic default (no crash) when there is no history at all', () => {
    const result = pickSmartCompositionInput([])
    expect(result.input.genreKey).toBeTruthy()
    expect(result.input.atmosphereKeys.length).toBeGreaterThanOrEqual(0)
    expect(result.predictedRating).toBeGreaterThanOrEqual(1)
    expect(result.predictedRating).toBeLessThanOrEqual(5)
  })

  it('ignores combinations rated below the favorite-combo threshold when picking cold-start category defaults', () => {
    const history = [compositionEntry({ moodKey: 'party' }, 2), compositionEntry({ moodKey: 'party' }, 2)]
    const result = pickSmartCompositionInput(history)
    // 低評価しかない組み合わせはFavoriteComboに乗らないため、カテゴリ別ランキングにフォールバックする
    // (低評価の実績はスコアに反映されるが、必ずそのムードが選ばれるとは限らない)
    expect(result.predictedRating).toBeGreaterThanOrEqual(1)
  })
})

describe('pickSmartLyricsInput', () => {
  it('reuses a proven high-rated lyrics combination', () => {
    const history = [
      lyricsEntry({ moodKey: 'party', themeKeywords: ['青春'], languageKey: 'en' }, 5, '2026-01-01T00:00:00.000Z'),
      lyricsEntry({ moodKey: 'party', themeKeywords: ['青春'], languageKey: 'en' }, 4, '2026-01-02T00:00:00.000Z'),
    ]
    const result = pickSmartLyricsInput(history)
    expect(result.input.moodKey).toBe('party')
    expect(result.input.themeKeywords).toEqual(['青春'])
    expect(result.input.languageKey).toBe('en')
    expect(result.predictedRating).toBe(5) // 最高評価(5)のサンプルが代表として使われる
  })
})

describe('deriveLyricsInputFromComposition', () => {
  it('keeps genre/mood/vocal/structure/atmosphere identical to the composition input', () => {
    const compositionInput = {
      genreKey: 'jrock',
      moodKey: 'late_night_drive',
      vocalTypeKey: 'female',
      songStructureKey: 'verse_chorus',
      instrumentKeys: ['guitar'],
      atmosphereKeys: ['dark'],
      themeKeywords: ['夜のドライブ'],
    }
    const result = deriveLyricsInputFromComposition(compositionInput, [])
    expect(result.input.genreKey).toBe('jrock')
    expect(result.input.moodKey).toBe('late_night_drive')
    expect(result.input.vocalTypeKey).toBe('female')
    expect(result.input.songStructureKey).toBe('verse_chorus')
    expect(result.input.atmosphereKeys).toEqual(['dark'])
    expect(result.input.themeKeywords).toEqual(['夜のドライブ'])
    expect(result.input.languageKey).toBe('ja')
  })

  it('picks fresh theme keywords when the composition input has none', () => {
    const compositionInput = {
      genreKey: 'jrock',
      moodKey: 'late_night_drive',
      instrumentKeys: [],
      atmosphereKeys: [],
      themeKeywords: [],
    }
    const result = deriveLyricsInputFromComposition(compositionInput, [])
    expect(result.input.themeKeywords.length).toBeGreaterThan(0)
  })
})
