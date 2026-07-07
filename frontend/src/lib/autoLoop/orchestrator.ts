import type {
  AutoLoopConfig,
  AutoLoopDiff,
  AutoLoopMetrics,
  AutoLoopStatus,
  CycleResult,
  ReviewResult,
  TesterResult,
} from '../../types/autoLoop'
import { DEFAULT_AUTO_LOOP_CONFIG } from '../../types/autoLoop'
import type { TemplateOverride } from '../../types/learning'
import type { TextGenome } from '../../types/textGenome'
import { EMPTY_GENOME, genomeFromMutations } from '../../types/textGenome'
import {
  addAutoLoopLifetimeStats,
  addDemotedKeyword,
  addDiscoveredKeyword,
  addKeywordAssociation,
  addTemplateOverride,
  addTempoHint,
  addTextMutation,
  getAllHistory,
  getDemotedKeywords,
  getDiscoveredKeywords,
  getKeywordAssociations,
  getTemplateOverrides,
  getTempoHints,
  getTextMutations,
} from '../db'
import { runExecutorCycle } from './executor'
import { reviewText } from './reviewer'
import { analyzeReviews } from './analyzer'
import { proposeDiff } from './improver'
import { testDiff } from './tester'
import {
  makeAssociationDiff,
  makeDemotionDiff,
  makeDiscoveryDiff,
  mineAssociationCandidates,
  mineDemotionCandidates,
  mineKeywordCandidates,
} from './keywordDiscovery'
import { makeTempoHintDiff, mineTempoCandidates } from './tempoLearning'

export interface AutoLoopEvent {
  metrics: AutoLoopMetrics
  latestCycle: CycleResult | null
}

type Listener = (event: AutoLoopEvent) => void

const RECENT_LOG_LIMIT = 50

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Execute → Review → Analyze → Improve → Test → (Apply|Skip) → Repeat のサイクルを回す。
 * 生成ロジック本体(promptGenerator/lyricsPromptGenerator)は一切変更せず、
 * 承認済みの改善は既存の TemplateOverride 機構(Epic F)を通じてのみ反映する。
 */
export class AutoLoopOrchestrator {
  private config: AutoLoopConfig
  private status: AutoLoopStatus = 'idle'
  private cycleIndex = 0
  private consecutiveFailures = 0
  private improvementsApplied = 0
  private improvementsRejected = 0
  private lastStopReason: string | undefined
  private reviewWindow: ReviewResult[] = []
  private recentTexts: string[] = []
  private overridesCache: TemplateOverride[] = []
  private genomeCache: TextGenome = EMPTY_GENOME
  private discoveredWordsCache: string[] = []
  private demotedWordsCache: string[] = []
  private pendingDiffQueue: AutoLoopDiff[] = []
  private recentLog: CycleResult[] = []
  private readonly listeners = new Set<Listener>()

  constructor(config: AutoLoopConfig = DEFAULT_AUTO_LOOP_CONFIG) {
    this.config = config
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getConfig(): AutoLoopConfig {
    return this.config
  }

  /** タブ切り替え等で購読が途切れていた間に発生したサイクルも見えるように、直近の履歴を保持する */
  getRecentLog(): CycleResult[] {
    return this.recentLog
  }

  getMetrics(): AutoLoopMetrics {
    const totalTested = this.improvementsApplied + this.improvementsRejected
    return {
      status: this.status,
      cyclesCompleted: this.cycleIndex,
      improvementsApplied: this.improvementsApplied,
      improvementsRejected: this.improvementsRejected,
      consecutiveFailures: this.consecutiveFailures,
      successRate: totalTested === 0 ? 0 : this.improvementsApplied / totalTested,
      lastStopReason: this.lastStopReason,
    }
  }

  private emit(latestCycle: CycleResult | null): void {
    const event: AutoLoopEvent = { metrics: this.getMetrics(), latestCycle }
    for (const listener of this.listeners) listener(event)
  }

  async start(configOverrides?: Partial<AutoLoopConfig>): Promise<void> {
    if (this.status === 'running') return

    this.config = { ...this.config, ...configOverrides }
    this.status = 'running'
    this.cycleIndex = 0
    this.consecutiveFailures = 0
    this.improvementsApplied = 0
    this.improvementsRejected = 0
    this.lastStopReason = undefined
    this.reviewWindow = []
    this.recentTexts = []
    this.recentLog = []
    this.overridesCache = await getTemplateOverrides().catch(() => [])
    this.genomeCache = genomeFromMutations(await getTextMutations().catch(() => []))

    // 語彙の自己学習: 既存の発見済み語彙・文脈連想・降格語を読み込み、評価付き履歴から
    // 新語彙の発見・文脈連想の学習・低評価語の降格を提案キューに積む
    // (レビュースコアが既に十分でも、実績に基づく確実な学習なので優先的に検証する)
    const discovered = await getDiscoveredKeywords().catch(() => [])
    this.discoveredWordsCache = discovered.map((k) => k.word)
    const associations = await getKeywordAssociations().catch(() => [])
    const demoted = await getDemotedKeywords().catch(() => [])
    this.demotedWordsCache = demoted.map((k) => k.word)

    const existingTempoHints = await getTempoHints().catch(() => [])

    const history = await getAllHistory().catch(() => [])
    const discoveryCandidates = mineKeywordCandidates(history, this.discoveredWordsCache)
    const associationCandidates = mineAssociationCandidates(history, associations)
    const demotionCandidates = mineDemotionCandidates(history, this.demotedWordsCache)
    const tempoCandidates = mineTempoCandidates(
      history,
      existingTempoHints.map((h) => h.genreKey),
    )
    this.pendingDiffQueue = [
      ...discoveryCandidates.map(makeDiscoveryDiff),
      ...associationCandidates.map(makeAssociationDiff),
      ...demotionCandidates.map(makeDemotionDiff),
      ...tempoCandidates.map(makeTempoHintDiff),
    ]

    this.emit(null)
    void this.runLoop()
  }

  pause(): void {
    if (this.status !== 'running') return
    this.status = 'paused'
    this.emit(null)
  }

  resume(): void {
    if (this.status !== 'paused') return
    this.status = 'running'
    this.emit(null)
  }

  stop(reason = 'ユーザーが停止しました'): void {
    if (this.status === 'idle' || this.status === 'stopped') return
    this.status = 'stopped'
    this.lastStopReason = reason
    this.emit(null)
  }

  private async applyDiff(diff: AutoLoopDiff): Promise<void> {
    if (diff.kind === 'ranking') {
      await addTemplateOverride({ category: diff.category, key: diff.key, boost: diff.delta, reason: diff.reason })
      this.overridesCache = await getTemplateOverrides()
    } else if (diff.kind === 'keywordDiscovery') {
      await addDiscoveredKeyword({ word: diff.word, source: diff.source, reason: diff.reason })
      this.discoveredWordsCache = (await getDiscoveredKeywords()).map((k) => k.word)
    } else if (diff.kind === 'keywordAssociation') {
      await addKeywordAssociation({
        word: diff.word,
        contextType: diff.contextType,
        contextKey: diff.contextKey,
        reason: diff.reason,
      })
    } else if (diff.kind === 'keywordDemotion') {
      await addDemotedKeyword({ word: diff.word, reason: diff.reason })
      this.demotedWordsCache = (await getDemotedKeywords()).map((k) => k.word)
    } else if (diff.kind === 'tempoHint') {
      await addTempoHint({
        genreKey: diff.genreKey,
        tempo: diff.tempo,
        sampleCount: diff.sampleCount,
        averageRating: diff.averageRating,
        reason: diff.reason,
      })
    } else {
      await addTextMutation({ type: diff.mutationType, value: diff.value, reason: diff.reason })
      this.genomeCache = genomeFromMutations(await getTextMutations())
    }
  }

  private async runOneCycle(): Promise<CycleResult> {
    this.cycleIndex++

    // 発見済み語彙も実行時のテーマ語彙プールに加える（発見→使用→評価→さらに発見のループ）。
    // 降格済みの語は逆にプールから除外し、以後ランダム生成にも使われないようにする。
    const variants = runExecutorCycle(this.config.concurrencyLimit, this.overridesCache, this.genomeCache, {
      extraThemeWords: this.discoveredWordsCache,
      excludeThemeWords: this.demotedWordsCache,
    })
    const reviews = variants.map((v) => reviewText(v.variantId, v.genreKey, v.text, v.expectedKeywords, this.recentTexts))

    this.recentTexts = [...this.recentTexts, ...variants.map((v) => v.text)].slice(-10)
    this.reviewWindow = [...this.reviewWindow, ...reviews]

    let diffProposed: AutoLoopDiff | null = null
    let testResult: TesterResult | null = null
    let applied = false

    if (this.reviewWindow.length >= this.config.reviewWindowSize) {
      const analysis = analyzeReviews(this.reviewWindow)
      // 語彙学習(発見・文脈連想・降格)の提案があれば最優先で検証する。ユーザーの評価実績という
      // 確実な根拠に基づくため、レビュースコアが閾値以上（=改善不要）の場合でも提案する。
      const queuedDiff = this.pendingDiffQueue.shift()
      diffProposed = queuedDiff ?? proposeDiff(analysis, this.config.reviewerScoreThreshold, this.genomeCache)

      if (diffProposed) {
        testResult = testDiff(
          diffProposed,
          this.overridesCache,
          this.genomeCache,
          this.config.reviewerScoreThreshold,
          this.config.concurrencyLimit,
        )

        if (testResult.passed) {
          try {
            await this.applyDiff(diffProposed)
            applied = true
            this.improvementsApplied++
            this.consecutiveFailures = 0
          } catch (err) {
            testResult = {
              ...testResult,
              passed: false,
              reason: `適用エラー: ${err instanceof Error ? err.message : String(err)}`,
              stack: err instanceof Error ? err.stack : undefined,
            }
            this.improvementsRejected++
            this.consecutiveFailures++
          }
        } else {
          this.improvementsRejected++
          this.consecutiveFailures++
        }
      }

      this.reviewWindow = []
    }

    const averageScore = reviews.reduce((sum, r) => sum + r.score, 0) / reviews.length

    return {
      cycleIndex: this.cycleIndex,
      timestamp: new Date().toISOString(),
      reviews,
      averageScore,
      diffProposed,
      testResult,
      applied,
    }
  }

  private async runLoop(): Promise<void> {
    while (this.status === 'running' || this.status === 'paused') {
      if (this.status === 'paused') {
        await sleep(200)
        continue
      }

      const cycleResult = await this.runOneCycle()
      this.recentLog = [cycleResult, ...this.recentLog].slice(0, RECENT_LOG_LIMIT)
      await addAutoLoopLifetimeStats({
        totalCyclesCompleted: 1,
        totalImprovementsApplied: cycleResult.applied ? 1 : 0,
        totalImprovementsRejected: cycleResult.testResult && !cycleResult.testResult.passed ? 1 : 0,
      }).catch(() => {})
      this.emit(cycleResult)

      if (this.consecutiveFailures >= this.config.failureThreshold) {
        this.status = 'stopped'
        this.lastStopReason = `連続${this.config.failureThreshold}回の改善失敗により自動停止しました`
        this.emit(null)
        break
      }

      if (this.cycleIndex >= this.config.maxCyclesPerSession) {
        this.status = 'stopped'
        this.lastStopReason = '最大サイクル数に到達しました'
        this.emit(null)
        break
      }

      await sleep(this.config.cycleDelayMs)
    }
  }
}
