import type { AnalysisResult, AutoLoopDiff } from '../../types/autoLoop'
import type { TextGenome } from '../../types/textGenome'

const BOOST_DELTA = 5

const DIMENSION_LABELS: Record<AnalysisResult['weakestDimension'], string> = {
  keyword: 'キーワード網羅率',
  hook: '冒頭のフック',
  grammar: '文法・書式',
  diversity: '多様性',
}

// 文章表現そのものを進化させるための候補プール。承認されるとテキスト遺伝子(TextGenome)に
// 追加され、以降の生成でランダムに混ぜ込まれる。既に採用済みのものは候補から除外する。
const HOOK_PHRASE_CANDIDATES = [
  'ねえ、聞いて――',
  '気づけば、',
  '今、伝えたい。',
  'その先に何があるのか――',
  '忘れられない、あの瞬間。',
  'もしも叶うなら――',
  '振り返れば、',
]

const CONNECTOR_PHRASE_CANDIDATES = [
  'そしてサビでは、感情を解き放ってください。',
  'だからこそ、言葉を尽くしてほしい。',
  '最後まで、想いを途切れさせないで。',
  '静けさの中にも、確かな熱を込めてください。',
  '余韻を残すように締めくくってください。',
]

function pickUnusedCandidate(pool: string[], used: string[]): string | null {
  const remaining = pool.filter((c) => !used.includes(c))
  if (remaining.length === 0) return null
  return remaining[Math.floor(Math.random() * remaining.length)]
}

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * 分析結果から1件だけ差分を提案する。
 * - 弱点が「冒頭のフック」→ フックフレーズを1件追加するテキスト変異を提案
 * - 弱点が「多様性」→ 接続フレーズを1件追加するテキスト変異を提案
 * - それ以外（キーワード網羅率・文法）、または上記候補が尽きた場合 →
 *   既存の自己学習ループ(Epic F)のジャンル優先度ブーストにフォールバック
 * 閾値を満たしていれば改善の余地なしとして null を返す。
 */
export function proposeDiff(analysis: AnalysisResult, scoreThreshold: number, currentGenome: TextGenome): AutoLoopDiff | null {
  if (analysis.averageScore >= scoreThreshold) return null

  if (analysis.weakestDimension === 'hook') {
    const candidate = pickUnusedCandidate(HOOK_PHRASE_CANDIDATES, currentGenome.hookPhrases)
    if (candidate) {
      return {
        kind: 'textMutation',
        id: newId(),
        mutationType: 'hookPhrase',
        value: candidate,
        reason:
          `直近${analysis.sampleSize}サイクルで冒頭のフックが弱く(平均${analysis.weakestDimensionScore.toFixed(2)})、` +
          `新しい冒頭フレーズ「${candidate}」を文章表現に追加します。`,
      }
    }
  }

  if (analysis.weakestDimension === 'diversity') {
    const candidate = pickUnusedCandidate(CONNECTOR_PHRASE_CANDIDATES, currentGenome.connectorPhrases)
    if (candidate) {
      return {
        kind: 'textMutation',
        id: newId(),
        mutationType: 'connectorPhrase',
        value: candidate,
        reason:
          `直近${analysis.sampleSize}サイクルで生成内容の多様性が低く(平均${analysis.weakestDimensionScore.toFixed(2)})、` +
          `新しい結びの一文「${candidate}」を文章表現に追加します。`,
      }
    }
  }

  if (!analysis.candidateGenreKey) return null

  return {
    kind: 'ranking',
    id: newId(),
    category: 'genreKey',
    key: analysis.candidateGenreKey,
    delta: BOOST_DELTA,
    reason:
      `直近${analysis.sampleSize}サイクルの平均スコアが${analysis.averageScore.toFixed(2)}(閾値${scoreThreshold})と低く、` +
      `弱点は${DIMENSION_LABELS[analysis.weakestDimension]}(${analysis.weakestDimensionScore.toFixed(2)})でした。` +
      `最も安定して高評価だったジャンル「${analysis.candidateGenreKey}」(平均${analysis.candidateGenreAverage.toFixed(2)})の` +
      `選択優先度を +${BOOST_DELTA} 引き上げます。`,
  }
}
