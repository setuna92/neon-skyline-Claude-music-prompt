export interface GenerationInput {
  genreKey: string
  moodKey?: string
  tempo?: number
  vocalTypeKey?: string
  instrumentKeys: string[]
  songStructureKey?: string
  atmosphereKeys: string[]
  /** 任意のテーマ・キーワード（ジャンル別キーワードバンクからの提案選択を含む）。旧履歴には存在しない。 */
  themeKeywords?: string[]
}

export interface GeneratedVariant {
  variantId: string
  styleId: string
  styleLabel: string
  englishPrompt: string
  japanesePrompt: string
}

export interface GenerationResult {
  input: GenerationInput
  variants: GeneratedVariant[]
  generatedAt: string
}

export interface ValidationResult {
  valid: boolean
  errors: string[]
}
