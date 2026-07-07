import type { AnalysisResult, ReviewResult, ReviewSubScores } from '../../types/autoLoop'

const DIMENSIONS: (keyof ReviewSubScores)[] = ['keyword', 'hook', 'grammar', 'diversity']

/**
 * 直近 reviewWindowSize 件のレビューを集計し、最も弱い評価次元と、
 * その中で最も平均スコアが高かったジャンル(=強化候補)を返す。
 */
export function analyzeReviews(reviews: ReviewResult[]): AnalysisResult {
  const sampleSize = reviews.length
  const averageScore = reviews.reduce((sum, r) => sum + r.score, 0) / sampleSize

  const dimensionAverages = DIMENSIONS.map((dim) => ({
    dim,
    avg: reviews.reduce((sum, r) => sum + r.subScores[dim], 0) / sampleSize,
  }))
  const weakest = dimensionAverages.reduce((min, cur) => (cur.avg < min.avg ? cur : min))

  const genreScores = new Map<string, { sum: number; count: number }>()
  for (const review of reviews) {
    const entry = genreScores.get(review.genreKey) ?? { sum: 0, count: 0 }
    entry.sum += review.score
    entry.count += 1
    genreScores.set(review.genreKey, entry)
  }

  let candidateGenreKey: string | null = null
  let candidateGenreAverage = 0
  for (const [genreKey, { sum, count }] of genreScores) {
    const avg = sum / count
    if (avg > candidateGenreAverage) {
      candidateGenreAverage = avg
      candidateGenreKey = genreKey
    }
  }

  return {
    sampleSize,
    averageScore,
    weakestDimension: weakest.dim,
    weakestDimensionScore: weakest.avg,
    candidateGenreKey,
    candidateGenreAverage,
  }
}
