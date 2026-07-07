import templatesData from '../../data/templates.json'
import type { PromptTemplates } from '../../types/templates'
import { generateVariants } from '../promptGenerator'
import { generateLyricsPromptVariants } from '../lyricsPromptGenerator'
import { deriveLyricsInputFromComposition, pickSmartCompositionInput } from '../smartSelect'
import { addHistoryEntry, getAllHistory, updateHistoryEntry } from '../db'

const templates = templatesData as PromptTemplates

/** 自動選択ループが作った履歴に付けるタグ。手動で作った履歴と区別できるようにする。 */
export const SMART_LOOP_TAG = '自動選択ループ'

export interface SmartLoopConfig {
  cycleDelayMs: number
  maxCyclesPerSession: number
}

export const DEFAULT_SMART_LOOP_CONFIG: SmartLoopConfig = {
  cycleDelayMs: 8000,
  maxCyclesPerSession: 20,
}

export type SmartLoopStatus = 'idle' | 'running' | 'stopped'

export interface SmartLoopMetrics {
  status: SmartLoopStatus
  cyclesCompleted: number
  lastStopReason?: string
}

export interface SmartLoopCycleResult {
  cycleIndex: number
  timestamp: string
  genreLabel: string
  predictedRating: number
  compositionHistoryId: string
  lyricsHistoryId: string
}

export interface SmartLoopEvent {
  metrics: SmartLoopMetrics
  latestCycle: SmartLoopCycleResult | null
}

type Listener = (event: SmartLoopEvent) => void

const RECENT_LOG_LIMIT = 50

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function genreLabelFor(genreKey: string): string {
  return templates.genres.find((g) => g.key === genreKey)?.label ?? genreKey
}

/**
 * 「自動選択」の相性ベースのロジックを使い、作曲プロンプト→対になる歌詞プロンプトを
 * 実際に生成して履歴に保存し続けるループ。既存のAuto-Loop(ルールベースの評価器で
 * ランキング/文章表現/語彙を学習する仕組み)とは目的が異なり、こちらは実際に使える
 * プロンプトを自動で作り、過去の評価傾向から予測した評価を自動で付与する。
 */
export class SmartGenerationLoop {
  private config: SmartLoopConfig = DEFAULT_SMART_LOOP_CONFIG
  private status: SmartLoopStatus = 'idle'
  private cycleIndex = 0
  private lastStopReason: string | undefined
  private recentLog: SmartLoopCycleResult[] = []
  private readonly listeners = new Set<Listener>()

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getConfig(): SmartLoopConfig {
    return this.config
  }

  getMetrics(): SmartLoopMetrics {
    return { status: this.status, cyclesCompleted: this.cycleIndex, lastStopReason: this.lastStopReason }
  }

  getRecentLog(): SmartLoopCycleResult[] {
    return this.recentLog
  }

  private emit(latestCycle: SmartLoopCycleResult | null): void {
    const event: SmartLoopEvent = { metrics: this.getMetrics(), latestCycle }
    for (const listener of this.listeners) listener(event)
  }

  async start(configOverrides?: Partial<SmartLoopConfig>): Promise<void> {
    if (this.status === 'running') return
    this.config = { ...this.config, ...configOverrides }
    this.status = 'running'
    this.cycleIndex = 0
    this.lastStopReason = undefined
    this.recentLog = []
    this.emit(null)
    void this.runLoop()
  }

  stop(reason = 'ユーザーが停止しました'): void {
    if (this.status !== 'running') return
    this.status = 'stopped'
    this.lastStopReason = reason
    this.emit(null)
  }

  private async runOneCycle(): Promise<SmartLoopCycleResult> {
    this.cycleIndex++

    const history = await getAllHistory().catch(() => [])

    const composition = pickSmartCompositionInput(history)
    const compositionResult = generateVariants(composition.input)
    const compositionEntry = await addHistoryEntry({
      kind: 'composition',
      input: composition.input,
      variants: compositionResult.variants,
      tags: [SMART_LOOP_TAG],
    })
    await updateHistoryEntry(compositionEntry.id, { rating: composition.predictedRating })

    const lyrics = deriveLyricsInputFromComposition(composition.input, history)
    const lyricsResult = generateLyricsPromptVariants(lyrics.input)
    const lyricsEntry = await addHistoryEntry({
      kind: 'lyricsPrompt',
      input: lyrics.input,
      variants: lyricsResult.variants,
      tags: [SMART_LOOP_TAG],
    })
    await updateHistoryEntry(lyricsEntry.id, { rating: lyrics.predictedRating })

    return {
      cycleIndex: this.cycleIndex,
      timestamp: new Date().toISOString(),
      genreLabel: genreLabelFor(composition.input.genreKey),
      predictedRating: composition.predictedRating,
      compositionHistoryId: compositionEntry.id,
      lyricsHistoryId: lyricsEntry.id,
    }
  }

  private async runLoop(): Promise<void> {
    while (this.status === 'running') {
      let result: SmartLoopCycleResult
      try {
        result = await this.runOneCycle()
      } catch (err) {
        this.status = 'stopped'
        this.lastStopReason = `エラーのため停止しました: ${err instanceof Error ? err.message : String(err)}`
        this.emit(null)
        break
      }

      this.recentLog = [result, ...this.recentLog].slice(0, RECENT_LOG_LIMIT)
      this.emit(result)

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
