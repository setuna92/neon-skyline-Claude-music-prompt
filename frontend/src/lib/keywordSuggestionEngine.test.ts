import { describe, expect, it } from 'vitest'
import {
  buildKeywordSuggestions,
  rankWordsByScore,
  scoreKeywordsFromHistory,
} from './keywordSuggestionEngine'
import type { KeywordScore } from './keywordSuggestionEngine'
import type { CompositionHistoryEntry, LyricsPromptHistoryEntry } from '../types/persistence'
import type { KeywordAssociation } from '../types/learning'
import { SMART_LOOP_TAG } from './learning/trainingData'

function compositionEntry(themeKeywords: string[], rating?: number): CompositionHistoryEntry {
  return {
    id: crypto.randomUUID(),
    kind: 'composition',
    createdAt: new Date().toISOString(),
    tags: [],
    rating,
    input: { genreKey: 'pop', instrumentKeys: [], atmosphereKeys: [], themeKeywords },
    variants: [],
  }
}

function lyricsEntry(themeKeywords: string[], rating?: number): LyricsPromptHistoryEntry {
  return {
    id: crypto.randomUUID(),
    kind: 'lyricsPrompt',
    createdAt: new Date().toISOString(),
    tags: [],
    rating,
    input: { genreKey: 'pop', atmosphereKeys: [], themeKeywords, languageKey: 'ja' },
    variants: [],
  }
}

describe('scoreKeywordsFromHistory', () => {
  it('aggregates ratings per keyword across composition and lyrics entries', () => {
    const scores = scoreKeywordsFromHistory([
      compositionEntry(['夏'], 4),
      lyricsEntry(['夏', '花火'], 5),
    ])
    expect(scores.get('夏')).toEqual({ sampleCount: 2, averageRating: 4.5 })
    expect(scores.get('花火')).toEqual({ sampleCount: 1, averageRating: 5 })
  })

  it('ignores unrated entries and entries without themeKeywords', () => {
    const legacyEntry = compositionEntry([], 5)
    delete (legacyEntry.input as { themeKeywords?: string[] }).themeKeywords
    const scores = scoreKeywordsFromHistory([compositionEntry(['夏'], undefined), legacyEntry])
    expect(scores.size).toBe(0)
  })

  it('scores lyricsPrompt keywords by the actual lyrics quality rating when recorded, not the prompt rating', () => {
    const entry = lyricsEntry(['夏'], 2)
    entry.lyricsQualityRating = 5
    const scores = scoreKeywordsFromHistory([entry])
    expect(scores.get('夏')).toEqual({ sampleCount: 1, averageRating: 5 })
  })

  it('excludes SmartGenerationLoop auto-rated entries so the loop cannot reinforce its own guesses', () => {
    const entry = compositionEntry(['夏'], 5)
    entry.tags = [SMART_LOOP_TAG]
    const scores = scoreKeywordsFromHistory([entry])
    expect(scores.size).toBe(0)
  })
})

describe('rankWordsByScore', () => {
  it('keeps original order when no scores exist', () => {
    expect(rankWordsByScore(['a', 'b', 'c'], new Map())).toEqual(['a', 'b', 'c'])
  })

  it('moves higher-scored words to the front, sample count damping outliers', () => {
    const scores = new Map<string, KeywordScore>([
      ['a', { sampleCount: 1, averageRating: 5 }],
      ['c', { sampleCount: 10, averageRating: 4 }],
    ])
    expect(rankWordsByScore(['a', 'b', 'c'], scores)).toEqual(['c', 'a', 'b'])
  })
})

describe('buildKeywordSuggestions', () => {
  it('returns genre bank groups for a bank-having genre', () => {
    const groups = buildKeywordSuggestions({ genreKey: 'emo_electronic_rock_x_drumnbass' })
    expect(groups.length).toBeGreaterThan(0)
    expect(groups[0].id).toBe('genre:chorus_hooks')
  })

  it('returns a mood group when a mood with associated words is selected, even without a genre bank', () => {
    const groups = buildKeywordSuggestions({ genreKey: 'pop', moodKey: 'late_night_drive' })
    expect(groups).toHaveLength(1)
    expect(groups[0].id).toBe('mood:late_night_drive')
    expect(groups[0].label).toContain('深夜ドライブ')
    expect(groups[0].words).toContain('ヘッドライト')
  })

  it('returns one group per selected atmosphere', () => {
    const groups = buildKeywordSuggestions({ atmosphereKeys: ['dark', 'neon_city_nightscape'] })
    expect(groups.map((g) => g.id)).toEqual(['atmosphere:dark', 'atmosphere:neon_city_nightscape'])
  })

  it('returns an empty array when nothing relevant is selected', () => {
    expect(buildKeywordSuggestions({})).toEqual([])
    expect(buildKeywordSuggestions({ genreKey: 'pop' })).toEqual([])
  })

  it('deduplicates words that appear in multiple groups (first group wins)', () => {
    const groups = buildKeywordSuggestions({
      genreKey: 'emo_electronic_rock_x_drumnbass',
      moodKey: 'late_night_drive',
    })
    const allWords = groups.flatMap((g) => g.words)
    expect(new Set(allWords).size).toBe(allWords.length)
  })

  it('appends a discovered-words group when discovered words are provided', () => {
    const groups = buildKeywordSuggestions({ moodKey: 'late_night_drive', discoveredWords: ['深夜のコンビニ帰り'] })
    const discovered = groups.find((g) => g.id === 'discovered')
    expect(discovered).toBeDefined()
    expect(discovered?.words).toEqual(['深夜のコンビニ帰り'])
    expect(groups[groups.length - 1].id).toBe('discovered')
  })

  it('shows the discovered group even when nothing else is selected', () => {
    const groups = buildKeywordSuggestions({ discoveredWords: ['未知語'] })
    expect(groups).toHaveLength(1)
    expect(groups[0].id).toBe('discovered')
  })

  it('reorders words within a group according to history scores', () => {
    const groups = buildKeywordSuggestions({ moodKey: 'late_night_drive' })
    const lastWord = groups[0].words[groups[0].words.length - 1]
    const scores = new Map<string, KeywordScore>([[lastWord, { sampleCount: 5, averageRating: 5 }]])
    const reranked = buildKeywordSuggestions({ moodKey: 'late_night_drive' }, scores)
    expect(reranked[0].words[0]).toBe(lastWord)
  })

  it('injects learned associations into the matching mood/atmosphere group', () => {
    const learnedAssociations: KeywordAssociation[] = [
      { id: '1', word: '深夜のコンビニ帰り', contextType: 'mood', contextKey: 'late_night_drive', reason: 'r', createdAt: '' },
      { id: '2', word: 'ネオン滲む窓', contextType: 'atmosphere', contextKey: 'dark', reason: 'r', createdAt: '' },
    ]
    const moodGroups = buildKeywordSuggestions({ moodKey: 'late_night_drive', learnedAssociations })
    expect(moodGroups[0].words).toContain('深夜のコンビニ帰り')

    const atmosphereGroups = buildKeywordSuggestions({ atmosphereKeys: ['dark'], learnedAssociations })
    expect(atmosphereGroups[0].words).toContain('ネオン滲む窓')
  })

  it('creates a mood/atmosphere group purely from a learned association even with no static words', () => {
    const learnedAssociations: KeywordAssociation[] = [
      { id: '1', word: '学習された語', contextType: 'mood', contextKey: 'nonexistent_mood', reason: 'r', createdAt: '' },
    ]
    const groups = buildKeywordSuggestions({ moodKey: 'nonexistent_mood', learnedAssociations })
    expect(groups).toHaveLength(1)
    expect(groups[0].words).toEqual(['学習された語'])
  })

  it('excludes demoted words from every group', () => {
    const groups = buildKeywordSuggestions({
      moodKey: 'late_night_drive',
      discoveredWords: ['ヘッドライト', '未知語'],
      demotedWords: ['ヘッドライト'],
    })
    const allWords = groups.flatMap((g) => g.words)
    expect(allWords).not.toContain('ヘッドライト')
    expect(allWords).toContain('未知語')
  })
})
