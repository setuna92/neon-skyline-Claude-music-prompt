import { describe, expect, it } from 'vitest'
import { analyzeReviews } from './analyzer'
import type { ReviewResult } from '../../types/autoLoop'

function review(genreKey: string, score: number, subScores: Partial<ReviewResult['subScores']> = {}): ReviewResult {
  return {
    variantId: 'v',
    genreKey,
    score,
    subScores: { keyword: 0.8, hook: 0.8, grammar: 0.8, diversity: 0.8, ...subScores },
    issues: [],
  }
}

describe('analyzeReviews', () => {
  it('computes the average score across the window', () => {
    const result = analyzeReviews([review('pop', 0.4), review('pop', 0.6)])
    expect(result.averageScore).toBeCloseTo(0.5, 5)
    expect(result.sampleSize).toBe(2)
  })

  it('identifies the weakest dimension', () => {
    const result = analyzeReviews([review('pop', 0.5, { hook: 0.1 }), review('pop', 0.5, { hook: 0.1 })])
    expect(result.weakestDimension).toBe('hook')
  })

  it('picks the genre with the highest average score as the candidate to reinforce', () => {
    const result = analyzeReviews([review('jrock', 0.9), review('jrock', 0.9), review('pop', 0.3)])
    expect(result.candidateGenreKey).toBe('jrock')
    expect(result.candidateGenreAverage).toBeCloseTo(0.9, 5)
  })
})
