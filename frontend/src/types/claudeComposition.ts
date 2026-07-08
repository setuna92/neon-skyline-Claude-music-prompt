import type { GenerationInput } from './generation'

/** 作曲プロンプトと同じ選択項目(ジャンル・ムード・テンポ等)をそのまま使う */
export type ClaudeCompositionInput = GenerationInput

export interface ClaudeCompositionVariant {
  variantId: string
  styleId: string
  styleLabel: string
  /** Claudeに送る、Suno向け作曲プロンプトを書かせるための指示文 */
  promptText: string
}

export interface ClaudeCompositionResult {
  input: ClaudeCompositionInput
  variants: ClaudeCompositionVariant[]
  generatedAt: string
}
