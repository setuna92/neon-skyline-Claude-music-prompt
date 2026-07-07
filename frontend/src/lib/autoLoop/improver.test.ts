import { describe, expect, it } from 'vitest'
import { proposeDiff } from './improver'
import type { AnalysisResult } from '../../types/autoLoop'
import { EMPTY_GENOME } from '../../types/textGenome'

const BASE_ANALYSIS: AnalysisResult = {
  sampleSize: 10,
  averageScore: 0.4,
  weakestDimension: 'keyword',
  weakestDimensionScore: 0.2,
  candidateGenreKey: 'jrock',
  candidateGenreAverage: 0.7,
}

describe('proposeDiff', () => {
  it('returns null when the average score already meets the threshold', () => {
    expect(proposeDiff({ ...BASE_ANALYSIS, averageScore: 0.8 }, 0.6, EMPTY_GENOME)).toBeNull()
  })

  it('returns null when there is no candidate genre and the weak dimension has no text-mutation lever', () => {
    expect(proposeDiff({ ...BASE_ANALYSIS, candidateGenreKey: null }, 0.6, EMPTY_GENOME)).toBeNull()
  })

  it('proposes a small genreKey boost for keyword/grammar weakness with a candidate genre', () => {
    const diff = proposeDiff(BASE_ANALYSIS, 0.6, EMPTY_GENOME)
    expect(diff?.kind).toBe('ranking')
    if (diff?.kind === 'ranking') {
      expect(diff.category).toBe('genreKey')
      expect(diff.key).toBe('jrock')
      expect(diff.delta).toBeGreaterThan(0)
      expect(diff.reason).toContain('jrock')
    }
  })

  it('proposes a hook-phrase text mutation when the weakest dimension is hook', () => {
    const diff = proposeDiff({ ...BASE_ANALYSIS, weakestDimension: 'hook' }, 0.6, EMPTY_GENOME)
    expect(diff?.kind).toBe('textMutation')
    if (diff?.kind === 'textMutation') {
      expect(diff.mutationType).toBe('hookPhrase')
      expect(diff.value.length).toBeGreaterThan(0)
    }
  })

  it('proposes a connector-phrase text mutation when the weakest dimension is diversity', () => {
    const diff = proposeDiff({ ...BASE_ANALYSIS, weakestDimension: 'diversity' }, 0.6, EMPTY_GENOME)
    expect(diff?.kind).toBe('textMutation')
    if (diff?.kind === 'textMutation') {
      expect(diff.mutationType).toBe('connectorPhrase')
    }
  })

  it('does not propose a hook phrase that is already in the genome', () => {
    const usedUp = proposeDiff(
      { ...BASE_ANALYSIS, weakestDimension: 'hook' },
      0.6,
      { hookPhrases: ['ねえ、聞いて――', '気づけば、', '今、伝えたい。', 'その先に何があるのか――', '忘れられない、あの瞬間。', 'もしも叶うなら――', '振り返れば、'], connectorPhrases: [] },
    )
    // 候補が尽きた場合はジャンルブーストにフォールバックする
    expect(usedUp?.kind).toBe('ranking')
  })
})
