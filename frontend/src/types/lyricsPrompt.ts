export interface LyricsPromptInput {
  genreKey: string
  moodKey?: string
  atmosphereKeys: string[]
  vocalTypeKey?: string
  songStructureKey?: string
  themeKeywords: string[]
  languageKey: 'ja' | 'en'
  basePromptText?: string
  /** 事前に決めた「主人公・出来事・結末」のあらすじ。指定時は歌詞プロンプトに必須条件として埋め込まれる */
  synopsis?: string
}

/** 作曲プロンプトから歌詞プロンプトへ引き継ぐ項目(言語・参考プロンプトは対象外) */
export type LyricsPromptSeed = Pick<
  LyricsPromptInput,
  'genreKey' | 'moodKey' | 'atmosphereKeys' | 'vocalTypeKey' | 'songStructureKey' | 'themeKeywords'
>

export interface LyricsPromptVariant {
  variantId: string
  styleId: string
  styleLabel: string
  promptText: string
}

export interface LyricsPromptResult {
  input: LyricsPromptInput
  variants: LyricsPromptVariant[]
  generatedAt: string
}
