import type { GenerationInput, GeneratedVariant } from './generation'
import type { LyricsPromptInput, LyricsPromptVariant } from './lyricsPrompt'
import type { ClaudeCompositionInput, ClaudeCompositionVariant } from './claudeComposition'

interface BaseHistoryEntry {
  id: string
  selectedVariantId?: string
  rating?: number
  tags: string[]
  createdAt: string
}

export interface CompositionHistoryEntry extends BaseHistoryEntry {
  kind: 'composition'
  input: GenerationInput
  variants: GeneratedVariant[]
}

export interface LyricsPromptHistoryEntry extends BaseHistoryEntry {
  kind: 'lyricsPrompt'
  input: LyricsPromptInput
  variants: LyricsPromptVariant[]
  /** 実際に得られた歌詞本文(Claude APIでもCopilot等へのコピペ経由でも、ユーザーが後から貼り付けたもの) */
  actualLyricsText?: string
  /** 実際に得られた歌詞そのものの評価(プロンプトの出来とは別軸)。自己学習ループはこちらを優先する。 */
  lyricsQualityRating?: number
}

export interface ClaudeCompositionHistoryEntry extends BaseHistoryEntry {
  kind: 'claudeComposition'
  input: ClaudeCompositionInput
  variants: ClaudeCompositionVariant[]
  /** Claudeが実際に書いた、Suno向け作曲プロンプト本文(ユーザーが後から貼り付けたもの) */
  actualCompositionPromptText?: string
  /** 実際に得られた作曲プロンプトそのものの評価(指示文の出来とは別軸)。自己学習ループはこちらを優先する。 */
  compositionPromptQualityRating?: number
}

export type HistoryEntry = CompositionHistoryEntry | LyricsPromptHistoryEntry | ClaudeCompositionHistoryEntry

export interface PresetEntry {
  id: string
  name: string
  input: GenerationInput
  createdAt: string
}

export interface EncryptedPayload {
  iv: string
  ciphertext: string
}

export interface ConsentRecord {
  granted: boolean
  grantedAt?: string
}
