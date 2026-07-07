export interface GenreKeywordCategories {
  general: string[]
  chorus_hooks: string[]
  imagery: string[]
  verbs: string[]
  adjectives: string[]
  short_phrases: string[]
  production_tags: string[]
}

export interface GenreKeywordEntry {
  genre: string
  keywords: GenreKeywordCategories
}

export interface GenreKeywordData {
  genres: GenreKeywordEntry[]
}

export type KeywordSuggestionCategory = keyof GenreKeywordCategories

export const KEYWORD_SUGGESTION_CATEGORY_LABELS: Record<KeywordSuggestionCategory, string> = {
  general: '汎用ワード',
  chorus_hooks: 'サビ用フック語',
  imagery: 'イメージ語',
  verbs: '動詞',
  adjectives: '形容詞',
  short_phrases: '短いフレーズ',
  production_tags: 'プロダクション指示語',
}
