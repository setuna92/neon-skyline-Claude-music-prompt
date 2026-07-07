import { describe, expect, it } from 'vitest'
import {
  getKnownWords,
  makeAssociationDiff,
  makeDemotionDiff,
  makeDiscoveryDiff,
  mineAssociationCandidates,
  mineDemotionCandidates,
  mineKeywordCandidates,
} from './keywordDiscovery'
import type { CompositionHistoryEntry, LyricsPromptHistoryEntry } from '../../types/persistence'
import type { KeywordAssociation } from '../../types/learning'

function ratedEntry(
  themeKeywords: string[],
  rating?: number,
  context: { moodKey?: string; atmosphereKeys?: string[] } = {},
): CompositionHistoryEntry {
  return {
    id: crypto.randomUUID(),
    kind: 'composition',
    createdAt: new Date().toISOString(),
    tags: [],
    rating,
    input: {
      genreKey: 'pop',
      instrumentKeys: [],
      atmosphereKeys: context.atmosphereKeys ?? [],
      moodKey: context.moodKey,
      themeKeywords,
    },
    variants: [],
  }
}

function lyricsRatedEntry(themeKeywords: string[], rating: number | undefined, lyricsQualityRating: number): LyricsPromptHistoryEntry {
  return {
    id: crypto.randomUUID(),
    kind: 'lyricsPrompt',
    createdAt: new Date().toISOString(),
    tags: [],
    rating,
    lyricsQualityRating,
    input: { genreKey: 'pop', atmosphereKeys: [], themeKeywords, languageKey: 'ja' },
    variants: [],
  }
}

describe('getKnownWords', () => {
  it('contains words from every existing pool', () => {
    const known = getKnownWords()
    expect(known.has('夏')).toBe(true) // 実行用テーマバンク
    expect(known.has('ヘッドライト')).toBe(true) // ムード連想語
    expect(known.has('ネオンサイン')).toBe(true) // 雰囲気連想語
    expect(known.has('壊れないで')).toBe(true) // ジャンルバンク(chorus_hooks)
    expect(known.has('この語はどこにも無いはず')).toBe(false)
  })
})

describe('mineKeywordCandidates', () => {
  const UNKNOWN = '深夜のコンビニ帰り' // どのプールにも無い手入力想定の語

  it('promotes an unknown keyword with enough high-rated samples', () => {
    const candidates = mineKeywordCandidates([ratedEntry([UNKNOWN], 5), ratedEntry([UNKNOWN], 4)])
    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toEqual({ word: UNKNOWN, sampleCount: 2, averageRating: 4.5 })
  })

  it('does not promote words that already exist in a pool', () => {
    const candidates = mineKeywordCandidates([ratedEntry(['夏'], 5), ratedEntry(['夏'], 5)])
    expect(candidates).toHaveLength(0)
  })

  it('does not promote with fewer than 2 samples or an average below 4', () => {
    expect(mineKeywordCandidates([ratedEntry([UNKNOWN], 5)])).toHaveLength(0)
    expect(mineKeywordCandidates([ratedEntry([UNKNOWN], 3), ratedEntry([UNKNOWN], 4)])).toHaveLength(0)
  })

  it('skips unrated entries and already-discovered words', () => {
    expect(mineKeywordCandidates([ratedEntry([UNKNOWN]), ratedEntry([UNKNOWN])])).toHaveLength(0)
    expect(
      mineKeywordCandidates([ratedEntry([UNKNOWN], 5), ratedEntry([UNKNOWN], 5)], [UNKNOWN]),
    ).toHaveLength(0)
  })

  it('sorts candidates by average rating descending', () => {
    const candidates = mineKeywordCandidates([
      ratedEntry(['未知語A'], 4),
      ratedEntry(['未知語A'], 4),
      ratedEntry(['未知語B'], 5),
      ratedEntry(['未知語B'], 5),
    ])
    expect(candidates.map((c) => c.word)).toEqual(['未知語B', '未知語A'])
  })

  it('uses lyricsQualityRating instead of the prompt rating for lyricsPrompt entries', () => {
    const candidates = mineKeywordCandidates([
      lyricsRatedEntry([UNKNOWN], 2, 5),
      lyricsRatedEntry([UNKNOWN], 2, 5),
    ])
    expect(candidates).toEqual([{ word: UNKNOWN, sampleCount: 2, averageRating: 5 }])
  })
})

describe('makeDiscoveryDiff', () => {
  it('produces a keywordDiscovery diff with an evidence-based reason', () => {
    const diff = makeDiscoveryDiff({ word: '深夜のコンビニ帰り', sampleCount: 3, averageRating: 4.7 })
    expect(diff.kind).toBe('keywordDiscovery')
    expect(diff.word).toBe('深夜のコンビニ帰り')
    expect(diff.source).toBe('history')
    expect(diff.reason).toContain('深夜のコンビニ帰り')
    expect(diff.reason).toContain('3件')
    expect(diff.reason).toContain('4.7')
  })
})

describe('mineAssociationCandidates', () => {
  it('proposes an association when a word is repeatedly used with the same mood and rated highly', () => {
    const candidates = mineAssociationCandidates([
      ratedEntry(['深夜のコンビニ帰り'], 5, { moodKey: 'late_night_drive' }),
      ratedEntry(['深夜のコンビニ帰り'], 4, { moodKey: 'late_night_drive' }),
    ])
    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toEqual({
      word: '深夜のコンビニ帰り',
      contextType: 'mood',
      contextKey: 'late_night_drive',
      sampleCount: 2,
      averageRating: 4.5,
    })
  })

  it('proposes an association per atmosphere key too', () => {
    const candidates = mineAssociationCandidates([
      ratedEntry(['錆びた鉄橋'], 5, { atmosphereKeys: ['dark', 'fast_paced'] }),
      ratedEntry(['錆びた鉄橋'], 5, { atmosphereKeys: ['dark'] }),
    ])
    expect(candidates.some((c) => c.contextType === 'atmosphere' && c.contextKey === 'dark')).toBe(true)
  })

  it('does not propose a word that is already a static association word for that context', () => {
    const candidates = mineAssociationCandidates([
      ratedEntry(['ヘッドライト'], 5, { moodKey: 'late_night_drive' }),
      ratedEntry(['ヘッドライト'], 5, { moodKey: 'late_night_drive' }),
    ])
    expect(candidates).toHaveLength(0)
  })

  it('respects the sample and rating thresholds', () => {
    expect(
      mineAssociationCandidates([ratedEntry(['単発語'], 5, { moodKey: 'late_night_drive' })]),
    ).toHaveLength(0)
    expect(
      mineAssociationCandidates([
        ratedEntry(['低評価語'], 3, { moodKey: 'late_night_drive' }),
        ratedEntry(['低評価語'], 3, { moodKey: 'late_night_drive' }),
      ]),
    ).toHaveLength(0)
  })

  it('excludes associations that were already learned', () => {
    const already: KeywordAssociation[] = [
      { id: '1', word: '既知語', contextType: 'mood', contextKey: 'late_night_drive', reason: 'r', createdAt: '' },
    ]
    const candidates = mineAssociationCandidates(
      [
        ratedEntry(['既知語'], 5, { moodKey: 'late_night_drive' }),
        ratedEntry(['既知語'], 5, { moodKey: 'late_night_drive' }),
      ],
      already,
    )
    expect(candidates).toHaveLength(0)
  })
})

describe('makeAssociationDiff', () => {
  it('produces a keywordAssociation diff with a context-aware reason', () => {
    const diff = makeAssociationDiff({
      word: '深夜のコンビニ帰り',
      contextType: 'mood',
      contextKey: 'late_night_drive',
      sampleCount: 2,
      averageRating: 4.5,
    })
    expect(diff.kind).toBe('keywordAssociation')
    expect(diff.word).toBe('深夜のコンビニ帰り')
    expect(diff.contextType).toBe('mood')
    expect(diff.contextKey).toBe('late_night_drive')
    expect(diff.reason).toContain('ムード')
    expect(diff.reason).toContain('late_night_drive')
  })
})

describe('mineDemotionCandidates', () => {
  it('proposes demotion for a word with enough samples and a low average rating', () => {
    const candidates = mineDemotionCandidates([
      ratedEntry(['微妙な語'], 2),
      ratedEntry(['微妙な語'], 2),
      ratedEntry(['微妙な語'], 3),
    ])
    expect(candidates).toHaveLength(1)
    expect(candidates[0].word).toBe('微妙な語')
    expect(candidates[0].sampleCount).toBe(3)
  })

  it('does not propose demotion with fewer than 3 samples or an average above the threshold', () => {
    expect(mineDemotionCandidates([ratedEntry(['語'], 2), ratedEntry(['語'], 2)])).toHaveLength(0)
    expect(
      mineDemotionCandidates([ratedEntry(['語'], 3), ratedEntry(['語'], 3), ratedEntry(['語'], 3)]),
    ).toHaveLength(0)
  })

  it('excludes words that are already demoted', () => {
    expect(
      mineDemotionCandidates(
        [ratedEntry(['語'], 1), ratedEntry(['語'], 1), ratedEntry(['語'], 1)],
        ['語'],
      ),
    ).toHaveLength(0)
  })
})

describe('makeDemotionDiff', () => {
  it('produces a keywordDemotion diff with an evidence-based reason', () => {
    const diff = makeDemotionDiff({ word: '微妙な語', sampleCount: 3, averageRating: 2.0 })
    expect(diff.kind).toBe('keywordDemotion')
    expect(diff.word).toBe('微妙な語')
    expect(diff.reason).toContain('3件')
    expect(diff.reason).toContain('2.0')
  })
})
