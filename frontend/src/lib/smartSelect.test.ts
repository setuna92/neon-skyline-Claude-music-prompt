import { afterEach, describe, expect, it, vi } from 'vitest'
import { deriveLyricsInputFromComposition, pickSmartCompositionInput, pickSmartLyricsInput } from './smartSelect'
import type { CompositionHistoryEntry, ClaudeCompositionHistoryEntry, LyricsPromptHistoryEntry } from './../types/persistence'

afterEach(() => {
  vi.restoreAllMocks()
})

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

function claudeCompositionEntry(
  overrides: Partial<ClaudeCompositionHistoryEntry['input']>,
  rating: number | undefined,
  createdAt = new Date().toISOString(),
): ClaudeCompositionHistoryEntry {
  return {
    id: crypto.randomUUID(),
    kind: 'claudeComposition',
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

    // 探索(exploration)のためにお気に入り組み合わせをあえて無視する確率があるので、
    // このテストでは無視されない側の分岐を固定して検証する
    vi.spyOn(Math, 'random').mockReturnValue(0.9)
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

  it('learns favorite combos from claudeComposition history too (same input shape as composition)', () => {
    // 「作曲」タブと「Claude作曲」タブは選択項目・創作の好みが同じなので、Claude作曲だけを
    // 使っているユーザーでも自動選択がその実績を活用できる必要がある。
    const history = [
      claudeCompositionEntry({ moodKey: 'party' }, 5, '2026-01-01T00:00:00.000Z'),
      claudeCompositionEntry({ moodKey: 'party' }, 5, '2026-01-02T00:00:00.000Z'),
    ]
    vi.spyOn(Math, 'random').mockReturnValue(0.9)
    const result = pickSmartCompositionInput(history)
    expect(result.input.moodKey).toBe('party')
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

  it('never picks a genre outside allowedGenreKeys, even with a favorite combo for a different genre', () => {
    const history = [
      compositionEntry({ genreKey: 'jrock', moodKey: 'late_night_drive' }, 5, '2026-01-01T00:00:00.000Z'),
      compositionEntry({ genreKey: 'jrock', moodKey: 'late_night_drive' }, 5, '2026-01-02T00:00:00.000Z'),
    ]
    for (let i = 0; i < 10; i++) {
      const result = pickSmartCompositionInput(history, { allowedGenreKeys: ['city_pop'] })
      expect(result.input.genreKey).toBe('city_pop')
    }
  })

  it('produces varied genre/mood picks across repeated calls on the same cold-start history (no fixed convergence)', () => {
    const genres = new Set<string>()
    for (let i = 0; i < 30; i++) {
      genres.add(pickSmartCompositionInput([]).input.genreKey)
    }
    expect(genres.size).toBeGreaterThan(1)
  })

  it('never repeats the exact same genre as the previous pick when avoidGenreKey is given (cold start)', () => {
    for (let i = 0; i < 30; i++) {
      const result = pickSmartCompositionInput([], { avoidGenreKey: 'jrock' })
      expect(result.input.genreKey).not.toBe('jrock')
    }
  })

  it('never re-picks the exact same favorite combo twice in a row when an alternative combo exists', () => {
    const history = [
      compositionEntry({ genreKey: 'jrock', moodKey: 'late_night_drive' }, 5, '2026-01-01T00:00:00.000Z'),
      compositionEntry({ genreKey: 'jrock', moodKey: 'late_night_drive' }, 5, '2026-01-02T00:00:00.000Z'),
      compositionEntry({ genreKey: 'city_pop', moodKey: 'party' }, 5, '2026-01-03T00:00:00.000Z'),
      compositionEntry({ genreKey: 'city_pop', moodKey: 'party' }, 5, '2026-01-04T00:00:00.000Z'),
    ]
    for (let i = 0; i < 20; i++) {
      const result = pickSmartCompositionInput(history, { avoidGenreKey: 'jrock', avoidMoodKey: 'late_night_drive' })
      expect(result.input.genreKey === 'jrock' && result.input.moodKey === 'late_night_drive').toBe(false)
    }
  })

  it('never repeats the only favorite combo when it is the one being avoided', () => {
    // 実際のバグの再現条件: お気に入り組み合わせが1件しかない状態で連打すると、
    // 除外後に候補が0件になり、除外前の(直前と同じ)組み合わせに逆戻りしていた。
    const history = [
      compositionEntry({ genreKey: 'jrock', moodKey: 'late_night_drive' }, 5, '2026-01-01T00:00:00.000Z'),
      compositionEntry({ genreKey: 'jrock', moodKey: 'late_night_drive' }, 5, '2026-01-02T00:00:00.000Z'),
    ]
    for (let i = 0; i < 20; i++) {
      const result = pickSmartCompositionInput(history, { avoidGenreKey: 'jrock', avoidMoodKey: 'late_night_drive' })
      expect(result.input.genreKey === 'jrock' && result.input.moodKey === 'late_night_drive').toBe(false)
    }
  })

  it('excludes SmartGenerationLoop auto-rated entries from favorite-combo selection (no self-reinforcement)', () => {
    const autoEntry = compositionEntry({ genreKey: 'jrock', moodKey: 'late_night_drive' }, 5, '2026-01-01T00:00:00.000Z')
    autoEntry.tags = ['自動選択ループ']
    const result = pickSmartCompositionInput([autoEntry, autoEntry])
    // 自動生成タグ付きの履歴は「実績」として扱われないため、predictedRatingは既定値(3)近辺のまま
    expect(result.predictedRating).toBeLessThan(5)
  })
})

describe('pickSmartLyricsInput', () => {
  it('reuses a proven high-rated lyrics combination', () => {
    const history = [
      lyricsEntry({ moodKey: 'party', themeKeywords: ['青春'], languageKey: 'en' }, 5, '2026-01-01T00:00:00.000Z'),
      lyricsEntry({ moodKey: 'party', themeKeywords: ['青春'], languageKey: 'en' }, 4, '2026-01-02T00:00:00.000Z'),
    ]
    // 探索(exploration)のためにお気に入り組み合わせをあえて無視する確率があるので、
    // このテストでは無視されない側の分岐を固定して検証する
    vi.spyOn(Math, 'random').mockReturnValue(0.9)
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
