export type RankingCategory =
  | 'genreKey'
  | 'moodKey'
  | 'vocalTypeKey'
  | 'songStructureKey'
  | 'atmosphereKeys'
  | 'instrumentKeys'
  | 'variantStyle'

export interface OptionScore {
  sampleCount: number
  averageRating: number
}

export interface TemplateOverride {
  id: string
  category: RankingCategory
  key: string
  boost: number
  reason: string
  createdAt: string
}

export interface TemplateSuggestion {
  category: RankingCategory
  key: string
  label: string
  averageRating: number
  sampleCount: number
  reason: string
}

/** Auto-Loopが自動発見して語彙に昇格させたキーワード（既存プールに無かった語） */
export interface DiscoveredKeyword {
  id: string
  word: string
  source: 'history' | 'autoloop'
  reason: string
  createdAt: string
}

export type KeywordAssociationContext = 'mood' | 'atmosphere'

/** Auto-Loopが学習した「特定のムード/雰囲気と組み合わせた時に高評価だった語」の連想付け */
export interface KeywordAssociation {
  id: string
  word: string
  contextType: KeywordAssociationContext
  contextKey: string
  reason: string
  createdAt: string
}

/** Auto-Loopが低評価の実績から提案対象外に降格させたキーワード */
export interface DemotedKeyword {
  id: string
  word: string
  reason: string
  createdAt: string
}

/** Auto-Loopが作曲履歴から学習した「そのジャンルで高評価だったテンポ(BPM)」 */
export interface TempoHint {
  id: string
  genreKey: string
  tempo: number
  sampleCount: number
  averageRating: number
  reason: string
  createdAt: string
}
