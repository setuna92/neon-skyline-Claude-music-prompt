import type { KeywordAssociationContext, RankingCategory } from './learning'
import type { TextMutationType } from './textGenome'

export interface AutoLoopConfig {
  concurrencyLimit: number
  cycleDelayMs: number
  maxCyclesPerSession: number
  failureThreshold: number
  reviewWindowSize: number
  reviewerScoreThreshold: number
  maxApiCallsPerSession: number
  executorMode: 'mock' | 'claude'
}

export const DEFAULT_AUTO_LOOP_CONFIG: AutoLoopConfig = {
  concurrencyLimit: 2,
  cycleDelayMs: 2000,
  maxCyclesPerSession: 1000,
  failureThreshold: 5,
  reviewWindowSize: 10,
  reviewerScoreThreshold: 0.6,
  maxApiCallsPerSession: 50,
  executorMode: 'mock',
}

export interface ExecutedVariant {
  variantId: string
  styleId: string
  genreKey: string
  text: string
  expectedKeywords: string[]
}

export interface ReviewSubScores {
  keyword: number
  hook: number
  grammar: number
  diversity: number
}

export interface ReviewResult {
  variantId: string
  genreKey: string
  score: number
  subScores: ReviewSubScores
  issues: string[]
}

export interface AnalysisResult {
  sampleSize: number
  averageScore: number
  weakestDimension: keyof ReviewSubScores
  weakestDimensionScore: number
  candidateGenreKey: string | null
  candidateGenreAverage: number
}

export interface RankingDiffProposal {
  kind: 'ranking'
  id: string
  category: RankingCategory
  key: string
  delta: number
  reason: string
}

export interface TextMutationProposal {
  kind: 'textMutation'
  id: string
  mutationType: TextMutationType
  value: string
  reason: string
}

export interface KeywordDiscoveryProposal {
  kind: 'keywordDiscovery'
  id: string
  word: string
  source: 'history' | 'autoloop'
  reason: string
}

/** 特定のムード/雰囲気と組み合わせた時に高評価だった語を、その文脈の連想語として学習する提案 */
export interface KeywordAssociationProposal {
  kind: 'keywordAssociation'
  id: string
  word: string
  contextType: KeywordAssociationContext
  contextKey: string
  reason: string
}

/** 低評価の実績が積み重なった語を、以後の提案から除外する提案 */
export interface KeywordDemotionProposal {
  kind: 'keywordDemotion'
  id: string
  word: string
  reason: string
}

/** 作曲履歴から学習した「そのジャンルで高評価だったテンポ(BPM)」をおすすめとして追加する提案 */
export interface TempoHintProposal {
  kind: 'tempoHint'
  id: string
  genreKey: string
  tempo: number
  sampleCount: number
  averageRating: number
  reason: string
}

/**
 * Improverが提案する差分。ランキングのブースト、文章表現の追加、新語彙の発見・文脈連想の学習・
 * 低評価語の除外・おすすめテンポの学習のいずれか。
 */
export type AutoLoopDiff =
  | RankingDiffProposal
  | TextMutationProposal
  | KeywordDiscoveryProposal
  | KeywordAssociationProposal
  | KeywordDemotionProposal
  | TempoHintProposal

export interface TesterResult {
  passed: boolean
  beforeScore: number
  afterScore: number
  reason: string
  /** 適用エラー発生時のスタックトレース(デバッグ用、UIでは折りたたみ表示) */
  stack?: string
}

export interface CycleResult {
  cycleIndex: number
  timestamp: string
  reviews: ReviewResult[]
  averageScore: number
  diffProposed: AutoLoopDiff | null
  testResult: TesterResult | null
  applied: boolean
}

export type AutoLoopStatus = 'idle' | 'running' | 'paused' | 'stopped'

export interface AutoLoopMetrics {
  status: AutoLoopStatus
  cyclesCompleted: number
  improvementsApplied: number
  improvementsRejected: number
  consecutiveFailures: number
  successRate: number
  lastStopReason?: string
}

/** ページ再読み込みやタブ切り替えをまたいでIndexedDBに永続化する累計実績 */
export interface AutoLoopLifetimeStats {
  totalCyclesCompleted: number
  totalImprovementsApplied: number
  totalImprovementsRejected: number
}

export const EMPTY_LIFETIME_STATS: AutoLoopLifetimeStats = {
  totalCyclesCompleted: 0,
  totalImprovementsApplied: 0,
  totalImprovementsRejected: 0,
}
