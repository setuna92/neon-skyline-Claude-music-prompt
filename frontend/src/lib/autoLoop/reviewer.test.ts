import { describe, expect, it } from 'vitest'
import { reviewText } from './reviewer'

describe('reviewText', () => {
  it('scores highly when all expected keywords are present and text ends properly', () => {
    const result = reviewText('v1', 'jrock', '夏の花火を、切なさとともに描いてください。', ['夏', '花火', '切なさ'], [])
    expect(result.subScores.keyword).toBe(1)
    expect(result.subScores.grammar).toBeGreaterThan(0.5)
    expect(result.score).toBeGreaterThan(0.5)
    expect(result.issues).not.toContain('キーワード網羅率が低い')
  })

  it('flags low keyword coverage', () => {
    const result = reviewText('v1', 'pop', '関係のない文章です。', ['夏', '花火', '切なさ'], [])
    expect(result.subScores.keyword).toBe(0)
    expect(result.issues).toContain('キーワード網羅率が低い')
  })

  it('flags missing terminal punctuation as a grammar issue', () => {
    const result = reviewText('v1', 'pop', '句読点がない文章', [], [])
    expect(result.subScores.grammar).toBeLessThan(1)
  })

  it('gives full diversity score when there is nothing to compare against', () => {
    const result = reviewText('v1', 'pop', '何かの文章です。', [], [])
    expect(result.subScores.diversity).toBe(1)
  })

  it('penalizes diversity when the text is near-identical to a recent one', () => {
    const text = '夏の花火を見に行きました。'
    const result = reviewText('v1', 'pop', text, [], [text])
    expect(result.subScores.diversity).toBeLessThan(0.5)
    expect(result.issues).toContain('直近の生成内容と類似しすぎている')
  })

  it('returns a score that is a weighted sum of the four sub-scores', () => {
    const result = reviewText('v1', 'pop', '夏の思い出。', ['夏'], [])
    const expected =
      0.4 * result.subScores.keyword +
      0.25 * result.subScores.hook +
      0.2 * result.subScores.grammar +
      0.15 * result.subScores.diversity
    expect(result.score).toBeCloseTo(expected, 10)
  })
})
