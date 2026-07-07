import { describe, expect, it } from 'vitest'
import { testDiff } from './tester'
import type { AutoLoopDiff } from '../../types/autoLoop'
import { EMPTY_GENOME } from '../../types/textGenome'

const RANKING_DIFF: AutoLoopDiff = {
  kind: 'ranking',
  id: 'test-diff',
  category: 'genreKey',
  key: 'jrock',
  delta: 5,
  reason: 'test',
}

const TEXT_MUTATION_DIFF: AutoLoopDiff = {
  kind: 'textMutation',
  id: 'test-mutation',
  mutationType: 'hookPhrase',
  value: 'ねえ、聞いて――',
  reason: 'test',
}

describe('testDiff', () => {
  it('returns a well-formed result with scores in [0, 1] for a ranking diff', () => {
    const result = testDiff(RANKING_DIFF, [], EMPTY_GENOME, 0.6, 2)
    expect(typeof result.passed).toBe('boolean')
    expect(result.beforeScore).toBeGreaterThanOrEqual(0)
    expect(result.beforeScore).toBeLessThanOrEqual(1)
    expect(result.afterScore).toBeGreaterThanOrEqual(0)
    expect(result.afterScore).toBeLessThanOrEqual(1)
    expect(result.reason.length).toBeGreaterThan(0)
  })

  it('returns a well-formed result for a text-mutation diff', () => {
    const result = testDiff(TEXT_MUTATION_DIFF, [], EMPTY_GENOME, 0.6, 2)
    expect(typeof result.passed).toBe('boolean')
    expect(result.beforeScore).toBeGreaterThanOrEqual(0)
    expect(result.afterScore).toBeGreaterThanOrEqual(0)
  })

  it('fails when the threshold is unreachable', () => {
    const result = testDiff(RANKING_DIFF, [], EMPTY_GENOME, 999, 2)
    expect(result.passed).toBe(false)
  })

  it('passes when the threshold is trivially low', () => {
    const result = testDiff(RANKING_DIFF, [], EMPTY_GENOME, -1, 2)
    expect(result.passed).toBe(true)
  })
})
