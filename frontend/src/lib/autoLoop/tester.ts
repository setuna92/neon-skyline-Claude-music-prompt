import type { AutoLoopDiff, TesterResult } from '../../types/autoLoop'
import type { TemplateOverride } from '../../types/learning'
import type { TextGenome } from '../../types/textGenome'
import type { ExecutorOptions } from './executor'
import { runExecutorCycle } from './executor'
import { reviewText } from './reviewer'

// before/after はそれぞれ独立したランダム入力から評価するため、少ないサンプルだと
// 差分の効果とは無関係な測定ノイズだけで「悪化」判定になりやすい。
// サンプル数を底上げし、僅かな差は悪化とみなさない許容誤差を設ける。
const MIN_SAMPLE_SIZE = 6
const REGRESSION_TOLERANCE = 0.05

function averageScoreFor(
  overrides: TemplateOverride[],
  genome: TextGenome,
  sampleSize: number,
  options: ExecutorOptions = {},
): number {
  const variants = runExecutorCycle(sampleSize, overrides, genome, options)
  const reviews = variants.map((v) => reviewText(v.variantId, v.genreKey, v.text, v.expectedKeywords, []))
  return reviews.reduce((sum, r) => sum + r.score, 0) / reviews.length
}

interface SpeculativeState {
  overrides: TemplateOverride[]
  genome: TextGenome
  executorOptions: ExecutorOptions
}

function applySpeculativeDiff(diff: AutoLoopDiff, overrides: TemplateOverride[], genome: TextGenome): SpeculativeState {
  if (diff.kind === 'ranking') {
    return {
      overrides: [
        ...overrides,
        { id: 'speculative', category: diff.category, key: diff.key, boost: diff.delta, reason: diff.reason, createdAt: '' },
      ],
      genome,
      executorOptions: {},
    }
  }

  if (diff.kind === 'keywordDiscovery' || diff.kind === 'keywordAssociation') {
    // 候補語を必ずテーマキーワードに含めた生成で品質を確認する
    return { overrides, genome, executorOptions: { forcedThemeWords: [diff.word] } }
  }

  if (diff.kind === 'keywordDemotion' || diff.kind === 'tempoHint') {
    // testDiff() 側で先に処理されるためここには実際には到達しないが、型を満たすためのno-op
    return { overrides, genome, executorOptions: {} }
  }

  return {
    overrides,
    genome: {
      hookPhrases: diff.mutationType === 'hookPhrase' ? [...genome.hookPhrases, diff.value] : genome.hookPhrases,
      connectorPhrases:
        diff.mutationType === 'connectorPhrase' ? [...genome.connectorPhrases, diff.value] : genome.connectorPhrases,
    },
    executorOptions: {},
  }
}

/**
 * 差分を実際には保存せず、一時的に適用したかのように振る舞わせて再生成・再評価し、
 * スコアが悪化していないか、かつ閾値を満たすかを検証する。
 * 合格した場合のみ Orchestrator 側で永続化する（ランキング差分は addTemplateOverride、
 * テキスト変異は addTextMutation、発見語彙は addDiscoveredKeyword）。
 */
export function testDiff(
  diff: AutoLoopDiff,
  existingOverrides: TemplateOverride[],
  existingGenome: TextGenome,
  scoreThreshold: number,
  sampleSize: number,
): TesterResult {
  if (diff.kind === 'keywordDemotion') {
    // 除外は生成テキストの内容に影響しないため、生成品質の再検証は不要。
    // マイニング側の閾値(件数・平均評価)が既に十分な検証根拠になっている。
    return { passed: true, beforeScore: 0, afterScore: 0, reason: '低評価実績に基づく除外のため、生成品質の再検証は不要です' }
  }

  if (diff.kind === 'tempoHint') {
    // テンポは歌詞プロンプトの文章(Reviewerの評価対象)に一切影響しないため、
    // 作曲履歴での実績(マイニング側の閾値)自体が検証根拠となる。
    return { passed: true, beforeScore: 0, afterScore: 0, reason: '作曲履歴での実績に基づく学習のため、生成品質の再検証は不要です' }
  }

  const effectiveSampleSize = Math.max(sampleSize, MIN_SAMPLE_SIZE)
  const beforeScore = averageScoreFor(existingOverrides, existingGenome, effectiveSampleSize)

  const speculative = applySpeculativeDiff(diff, existingOverrides, existingGenome)
  const afterScore = averageScoreFor(
    speculative.overrides,
    speculative.genome,
    effectiveSampleSize,
    speculative.executorOptions,
  )

  const regressed = afterScore < beforeScore - REGRESSION_TOLERANCE
  const meetsThreshold = afterScore >= scoreThreshold

  if (regressed) {
    return { passed: false, beforeScore, afterScore, reason: 'スコアが悪化したため適用を見送りました' }
  }
  if (!meetsThreshold) {
    return { passed: false, beforeScore, afterScore, reason: `閾値(${scoreThreshold})に届かないため適用を見送りました` }
  }
  return { passed: true, beforeScore, afterScore, reason: '悪化なし・閾値を満たしたため適用します' }
}
