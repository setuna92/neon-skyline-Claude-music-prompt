import type { ReviewResult, ReviewSubScores } from '../../types/autoLoop'

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 0)
}

/** 期待キーワードのうち本文に含まれる割合（大文字小文字を無視した部分一致） */
function keywordScore(text: string, expectedKeywords: string[]): number {
  if (expectedKeywords.length === 0) return 1
  const lower = text.toLowerCase()
  const hits = expectedKeywords.filter((k) => lower.includes(k.toLowerCase())).length
  return hits / expectedKeywords.length
}

/** 冒頭付近(先頭40文字)にキーワードやフックらしき記号があるかの簡易ヒューリスティック */
function hookScore(text: string, expectedKeywords: string[]): number {
  if (!text) return 0
  const head = text.slice(0, 40).toLowerCase()
  const hasKeywordUpfront = expectedKeywords.some((k) => head.includes(k.toLowerCase()))
  const hasHookMarker = /[！？!?…—]/.test(head)
  if (hasKeywordUpfront && hasHookMarker) return 1
  if (hasKeywordUpfront || hasHookMarker) return 0.7
  return 0.4
}

/** 実文法チェックの代わりの簡易ヒューリスティック（句読点の存在・不自然な繰り返しの有無） */
function grammarScore(text: string): number {
  if (!text.trim()) return 0
  let score = 1
  if (!/[。.！!？?]$/.test(text.trim())) score -= 0.3
  if (/  +/.test(text)) score -= 0.2
  const words = tokenize(text)
  for (let i = 1; i < words.length; i++) {
    if (words[i] === words[i - 1]) {
      score -= 0.2
      break
    }
  }
  return Math.max(0, score)
}

/** 直近の生成テキスト群とのJaccard類似度の逆数（似ていないほど高スコア） */
function diversityScore(text: string, recentTexts: string[]): number {
  if (recentTexts.length === 0) return 1
  const current = new Set(tokenize(text))
  if (current.size === 0) return 0

  let maxSimilarity = 0
  for (const recent of recentTexts) {
    const other = new Set(tokenize(recent))
    const intersection = [...current].filter((w) => other.has(w)).length
    const union = new Set([...current, ...other]).size
    const similarity = union === 0 ? 0 : intersection / union
    maxSimilarity = Math.max(maxSimilarity, similarity)
  }
  return 1 - maxSimilarity
}

/**
 * ルールベースの自動評価。
 * score = 0.4*keyword + 0.25*hook + 0.2*grammar + 0.15*diversity
 */
export function reviewText(
  variantId: string,
  genreKey: string,
  text: string,
  expectedKeywords: string[],
  recentTexts: string[],
): ReviewResult {
  const subScores: ReviewSubScores = {
    keyword: keywordScore(text, expectedKeywords),
    hook: hookScore(text, expectedKeywords),
    grammar: grammarScore(text),
    diversity: diversityScore(text, recentTexts),
  }

  const score = 0.4 * subScores.keyword + 0.25 * subScores.hook + 0.2 * subScores.grammar + 0.15 * subScores.diversity

  const issues: string[] = []
  if (subScores.keyword < 0.5) issues.push('キーワード網羅率が低い')
  if (subScores.hook < 0.5) issues.push('冒頭のフックが弱い可能性')
  if (subScores.grammar < 0.7) issues.push('文法・書式に問題の可能性')
  if (subScores.diversity < 0.4) issues.push('直近の生成内容と類似しすぎている')

  return { variantId, genreKey, score, subScores, issues }
}
